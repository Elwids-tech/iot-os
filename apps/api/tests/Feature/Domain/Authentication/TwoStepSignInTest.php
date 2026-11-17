<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Authentication\Services\KeptSignInCookie;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Testing\TestResponse;
use Tests\Support\TwoStepFixtures;
use Tests\TestCase;

/** The second step of sign-in (spec 034, US1, FR-007 to FR-015). */
final class TwoStepSignInTest extends TestCase
{
    use RefreshDatabase, TwoStepFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
    }

    public function test_a_right_password_only_starts_a_pending_sign_in(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $this->turnOnTwoStep($user);

        $this->password($user)
            ->assertStatus(202)
            ->assertExactJson(['two_step_required' => true, 'expires_in' => 300, 'methods' => ['code', 'recovery_code']]);

        $this->assertGuest('web');
        $this->assertSame($user->id, session('two_step.pending.user_id'));
        $this->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertSame(0, KeptSignIn::query()->count());
    }

    public function test_a_pending_sign_in_is_a_guest_on_the_agent_consent_route(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $this->turnOnTwoStep($user);
        $this->password($user)->assertStatus(202);

        // Agent consent completes through the portal's session (SC-002, the consent path),
        // which a pending sign-in does not have.
        config(['agents.enabled' => true]);
        $this->assertGuest('web');
        $this->withHeader('Origin', 'http://localhost')->getJson('/api/v1/agent-authorizations/current')->assertUnauthorized();
    }

    public function test_people_without_two_step_sign_in_as_before(): void
    {
        $user = User::factory()->create(['password' => 'password']);

        $this->password($user)->assertOk()->assertJsonPath('data.email', $user->email);
        $this->assertAuthenticatedAs($user, 'web');
    }

    public function test_an_unconfirmed_setup_does_not_ask_for_a_code(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $this->turnOnTwoStep($user);
        $user->forceFill(['two_factor_confirmed_at' => null])->save();

        $this->password($user)->assertOk();
        $this->assertAuthenticatedAs($user, 'web');
    }

    public function test_a_valid_code_signs_in_and_keeps_the_browser_only_when_asked_at_the_password_step(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        [$secret] = $this->turnOnTwoStep($user);

        $this->password($user, remember: true)->assertStatus(202);
        $this->assertSame(0, KeptSignIn::query()->count());
        $response = $this->challenge(['code' => $this->totp($secret)])
            ->assertOk()
            ->assertJsonPath('data.email', $user->email)
            ->assertJsonMissingPath('recovery_codes_remaining');

        $this->assertAuthenticatedAs($user, 'web');
        $this->assertNotNull($response->getCookie(KeptSignInCookie::NAME));
        $this->assertTrue(KeptSignIn::query()->sole()->isLive());
        $this->assertNull(session('two_step.pending'));
        $this->getJson('/api/v1/me')->assertOk();

        $this->loseSession();
        $this->travel(31)->seconds();
        $this->password($user, remember: false)->assertStatus(202);
        $this->challenge(['code' => $this->totp($secret)])->assertOk()->assertCookieMissing(KeptSignInCookie::NAME);
        $this->assertSame(1, KeptSignIn::query()->count());
    }

    public function test_a_code_that_already_signed_in_is_refused_for_the_rest_of_its_window(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        [$secret] = $this->turnOnTwoStep($user);
        $code = $this->totp($secret);

        $this->password($user)->assertStatus(202);
        $this->challenge(['code' => $code])->assertOk();

        $this->loseSession();
        $this->password($user)->assertStatus(202);
        $this->challenge(['code' => $code])
            ->assertUnprocessable()
            ->assertJsonPath('errors.code.0', 'That code is not valid.')
            ->assertJsonPath('attempts_left', 4);
        $this->assertGuest('web');
    }

    public function test_a_recovery_code_signs_in_once_and_reports_how_many_remain(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        [, $codes] = $this->turnOnTwoStep($user);

        $this->password($user)->assertStatus(202);
        $this->challenge(['recovery_code' => ' '.$codes[3].' '])
            ->assertOk()
            ->assertJsonPath('recovery_codes_remaining', 7);
        $this->assertAuthenticatedAs($user, 'web');

        $user->refresh();
        $this->assertSame(7, $user->remainingRecoveryCodes());
        $this->assertNotContains($codes[3], $user->recoveryCodes());

        $activity = Activity::query()->where('event', SecurityChanged::RECOVERY_CODE_USED)->sole();
        $this->assertNull($activity->organization_id);
        $this->assertSame($user->id, (int) $activity->subject_id);
        $this->assertSame(7, $activity->properties['remaining']);
        Notification::assertSentTo($user, SecurityChanged::class, fn (SecurityChanged $n): bool => $n->event === SecurityChanged::RECOVERY_CODE_USED && $n->details === ['remaining' => 7]);

        $this->loseSession();
        $this->password($user)->assertStatus(202);
        $this->challenge(['recovery_code' => $codes[3]])->assertUnprocessable()->assertJsonPath('errors.recovery_code.0', 'That recovery code is not valid.');
        $this->assertGuest('web');
    }

    public function test_five_wrong_codes_end_the_pending_sign_in(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        [$secret] = $this->turnOnTwoStep($user);
        $wrong = $this->totp($secret) === '123456' ? '654321' : '123456';

        $this->password($user)->assertStatus(202);
        foreach ([4, 3, 2, 1] as $left) {
            $this->challenge(['code' => $wrong])->assertUnprocessable()->assertJsonPath('attempts_left', $left);
        }
        // The password and four codes used the account's five tries this minute.
        $this->challenge(['code' => $wrong])->assertTooManyRequests();
        $this->travel(61)->seconds();
        $this->challenge(['code' => $wrong])->assertUnprocessable()->assertJsonPath('errors.pending.0', 'Start again with your password.');

        $this->challenge(['code' => $this->totp($secret)])->assertUnprocessable()->assertJsonPath('errors.pending.0', 'Start again with your password.');
        $this->assertGuest('web');
    }

    public function test_the_pending_sign_in_expires_after_five_minutes(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        [$secret] = $this->turnOnTwoStep($user);

        $this->password($user)->assertStatus(202);
        $this->travel(301)->seconds();

        $this->challenge(['code' => $this->totp($secret)])->assertUnprocessable()->assertJsonPath('errors.pending.0', 'Start again with your password.');
        $this->assertGuest('web');
    }

    public function test_a_code_with_no_pending_sign_in_is_refused(): void
    {
        $this->challenge(['code' => '123456'])->assertUnprocessable()->assertJsonPath('errors.pending.0', 'Start again with your password.');
    }

    public function test_exactly_one_of_code_or_recovery_code_is_accepted(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $this->turnOnTwoStep($user);
        $this->password($user)->assertStatus(202);

        $this->challenge([])->assertUnprocessable()->assertJsonValidationErrors(['code', 'recovery_code']);
        $this->challenge(['code' => '123456', 'recovery_code' => 'abc'])->assertUnprocessable()->assertJsonValidationErrors(['code']);
        $this->challenge(['code' => '12345'])->assertUnprocessable()->assertJsonValidationErrors(['code']);
    }

    public function test_code_attempts_count_toward_the_sign_in_slowdown_for_that_account_and_address(): void
    {
        $user = User::factory()->create(['email' => 'operator@example.test', 'password' => 'password']);
        $this->turnOnTwoStep($user);

        // Three password attempts and two code attempts use up the account's five a minute.
        foreach (range(1, 3) as $ignored) {
            $this->password($user)->assertStatus(202);
        }
        $this->challenge(['code' => '000001'])->assertUnprocessable();
        $this->challenge(['code' => '000002'])->assertUnprocessable();
        $this->challenge(['code' => '000003'])->assertTooManyRequests();
        $this->password($user)->assertTooManyRequests();
    }

    public function test_a_password_reset_leaves_two_step_on(): void
    {
        $user = User::factory()->create(['email' => 'operator@example.test', 'password' => 'password']);
        $this->turnOnTwoStep($user);
        $token = Password::broker()->createToken($user);

        $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/auth/reset-password', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'a-new-Password-123',
            'password_confirmation' => 'a-new-Password-123',
        ])->assertOk();

        $this->assertTrue($user->refresh()->hasEnabledTwoFactorAuthentication());
        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'a-new-Password-123'])
            ->assertStatus(202);
        $this->assertGuest('web');
    }

    private function password(User $user, bool $remember = false): TestResponse
    {
        return $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password', 'remember' => $remember]);
    }

    /**
     * @param  array<string, string>  $body
     */
    private function challenge(array $body): TestResponse
    {
        return $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/auth/two-step', $body);
    }

    private function loseSession(): void
    {
        Auth::forgetGuards();
        $this->flushSession();
        Cookie::flushQueuedCookies();
        $this->defaultCookies = [];
    }
}
