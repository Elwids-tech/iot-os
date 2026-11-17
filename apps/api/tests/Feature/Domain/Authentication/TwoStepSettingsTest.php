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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Laravel\Fortify\Fortify;
use Tests\Support\TwoStepFixtures;
use Tests\TestCase;

/** A person's own two-step settings (spec 034, US1, FR-001 to FR-006, FR-013, FR-027 to FR-029). */
final class TwoStepSettingsTest extends TestCase
{
    use RefreshDatabase, TwoStepFixtures;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->user = User::factory()->create(['password' => 'password', 'email' => 'operator@example.test']);
    }

    public function test_changes_need_a_recently_confirmed_password(): void
    {
        $this->as()->postJson('/api/v1/me/two-step')->assertStatus(423);
        $this->as()->postJson('/api/v1/me/two-step/recovery-codes')->assertStatus(423);
        $this->as()->deleteJson('/api/v1/me/two-step')->assertStatus(423);

        $this->as()->postJson('/api/v1/auth/confirm-password', ['password' => 'wrong'])->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->as()->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();
        $this->as()->postJson('/api/v1/me/two-step')->assertOk();

        $this->travel(16)->minutes();
        $this->as()->postJson('/api/v1/me/two-step')->assertStatus(423);
    }

    public function test_guests_cannot_see_or_change_security_settings(): void
    {
        $this->withHeader('Origin', 'http://localhost')->getJson('/api/v1/me/security')->assertUnauthorized();
        $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/me/two-step/confirm', ['code' => '123456'])->assertUnauthorized();
    }

    public function test_setup_shows_a_qr_code_and_key_and_takes_effect_only_once_confirmed(): void
    {
        $this->confirmPassword();

        $setup = $this->as()->postJson('/api/v1/me/two-step')->assertOk()->json();
        $secret = Fortify::currentEncrypter()->decrypt($this->user->refresh()->two_factor_secret);
        $this->assertStringStartsWith('<svg', $setup['qr_svg']);
        $this->assertSame($secret, str_replace(' ', '', $setup['setup_key']));
        $this->assertStringStartsWith('otpauth://totp/', $setup['otpauth_url']);
        $this->assertFalse($this->user->hasEnabledTwoFactorAuthentication());
        $this->as()->getJson('/api/v1/me/security')->assertOk()->assertJsonPath('data.two_step.enabled', false);

        // Restarting replaces the unconfirmed secret (FR-002), and the old one never confirms.
        $restart = $this->as()->postJson('/api/v1/me/two-step')->assertOk()->json();
        $this->assertNotSame($setup['setup_key'], $restart['setup_key']);
        $this->as()->postJson('/api/v1/me/two-step/confirm', ['code' => $this->totp($secret)])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->assertNull($this->user->refresh()->two_factor_confirmed_at);
        Notification::assertNothingSent();
    }

    public function test_confirming_turns_two_step_on_shows_eight_codes_once_and_ends_other_sign_ins(): void
    {
        config(['session.driver' => 'database']);
        $this->confirmPassword();
        $this->as()->postJson('/api/v1/me/two-step')->assertOk();
        $secret = Fortify::currentEncrypter()->decrypt($this->user->refresh()->two_factor_secret);
        [$otherKept] = KeptSignIn::issue($this->user, 'Chrome on Android');
        [$thisKept] = KeptSignIn::issue($this->user, 'Safari on iPhone');
        $other = User::factory()->create();
        [$othersKept] = KeptSignIn::issue($other, 'Chrome on Android');
        DB::table('sessions')->insert([
            ['id' => 'other-browser', 'user_id' => $this->user->id, 'payload' => '', 'last_activity' => time()],
            ['id' => 'someone-else', 'user_id' => $other->id, 'payload' => '', 'last_activity' => time()],
        ]);
        $this->withSession([KeptSignInCookie::SESSION_KEY => $thisKept->id]);

        $codes = $this->as()->postJson('/api/v1/me/two-step/confirm', ['code' => $this->totp($secret)])
            ->assertOk()->assertJsonCount(8, 'recovery_codes')->json('recovery_codes');

        $this->assertTrue($this->user->refresh()->hasEnabledTwoFactorAuthentication());
        $this->assertSame($codes, $this->user->recoveryCodes());
        $this->assertSame(KeptSignIn::TWO_STEP_CHANGED, $otherKept->refresh()->end_reason);
        $this->assertTrue($thisKept->refresh()->isLive());
        $this->assertTrue($othersKept->refresh()->isLive());
        $this->assertDatabaseMissing('sessions', ['id' => 'other-browser']);
        $this->assertDatabaseHas('sessions', ['id' => 'someone-else']);

        $security = $this->as()->getJson('/api/v1/me/security')->assertOk()
            ->assertJsonPath('data.two_step.enabled', true)
            ->assertJsonPath('data.two_step.recovery_codes_remaining', 8)
            ->assertJsonPath('data.two_step.satisfied', true)
            ->assertJsonPath('data.two_step.required', false);
        foreach ($codes as $code) {
            $this->assertStringNotContainsString($code, (string) $security->getContent());
        }
        $this->assertStringNotContainsString($secret, (string) $security->getContent());

        $this->assertActivity(SecurityChanged::TWO_STEP_ENABLED);
        $this->as()->postJson('/api/v1/me/two-step')->assertStatus(409)->assertJsonPath('code', 'two_step_already_on');
    }

    public function test_new_recovery_codes_replace_every_earlier_one(): void
    {
        [, $old] = $this->turnOnTwoStep($this->user);
        $this->confirmPassword();

        $new = $this->as()->postJson('/api/v1/me/two-step/recovery-codes')->assertOk()->assertJsonCount(8, 'recovery_codes')->json('recovery_codes');

        $this->assertSame([], array_intersect($old, $new));
        $this->assertSame($new, $this->user->refresh()->recoveryCodes());
        $this->assertActivity(SecurityChanged::RECOVERY_CODES_REGENERATED);
    }

    public function test_turning_two_step_off_ends_other_sign_ins_and_tells_the_person(): void
    {
        $this->turnOnTwoStep($this->user);
        [$otherKept] = KeptSignIn::issue($this->user, 'Chrome on Android');
        $this->confirmPassword();

        $this->as()->deleteJson('/api/v1/me/two-step')->assertNoContent();

        $this->user->refresh();
        $this->assertFalse($this->user->hasEnabledTwoFactorAuthentication());
        $this->assertNull($this->user->two_factor_secret);
        $this->assertNull($this->user->two_factor_recovery_codes);
        $this->assertSame(KeptSignIn::TWO_STEP_CHANGED, $otherKept->refresh()->end_reason);
        $this->assertActivity(SecurityChanged::TWO_STEP_DISABLED);
        $this->as()->postJson('/api/v1/me/two-step/recovery-codes')->assertStatus(409)->assertJsonPath('code', 'two_step_off');
    }

    public function test_discarding_an_unconfirmed_setup_is_not_news(): void
    {
        $this->confirmPassword();
        $this->as()->postJson('/api/v1/me/two-step')->assertOk();

        $this->as()->deleteJson('/api/v1/me/two-step')->assertNoContent();

        $this->assertNull($this->user->refresh()->two_factor_secret);
        $this->assertSame(0, Activity::query()->where('event', 'like', 'person.%')->count());
        Notification::assertNothingSent();
    }

    public function test_the_security_mail_names_the_change_and_holds_no_secret(): void
    {
        [$secret, $codes] = $this->turnOnTwoStep($this->user);

        foreach ([
            SecurityChanged::TWO_STEP_ENABLED => [],
            SecurityChanged::TWO_STEP_DISABLED => [],
            SecurityChanged::RECOVERY_CODES_REGENERATED => [],
            SecurityChanged::RECOVERY_CODE_USED => ['remaining' => 0],
            SecurityChanged::PASSKEY_ADDED => ['name' => 'MacBook'],
            SecurityChanged::PASSKEY_REMOVED => ['name' => 'MacBook'],
            SecurityChanged::TWO_STEP_RESET => ['source' => 'console'],
        ] as $event => $details) {
            $mail = (new SecurityChanged($event, $details))->toMail($this->user);
            $text = $mail->subject.' '.implode(' ', $mail->introLines).' '.implode(' ', $mail->outroLines);
            $this->assertStringNotContainsString($secret, $text);
            foreach ($codes as $code) {
                $this->assertStringNotContainsString($code, $text);
            }
            $this->assertNotSame('Your sign-in security changed', $mail->subject, $event);
        }
        $used = (new SecurityChanged(SecurityChanged::RECOVERY_CODE_USED, ['remaining' => 0]))->toMail($this->user);
        $this->assertStringContainsString('no recovery codes left', implode(' ', $used->introLines));
    }

    private function assertActivity(string $event): void
    {
        $activity = Activity::query()->where('event', $event)->sole();
        $this->assertNull($activity->organization_id);
        $this->assertSame($this->user->id, (int) $activity->subject_id);
        $this->assertSame($this->user->id, (int) $activity->causer_id);
        $this->assertStringNotContainsString('two_factor', json_encode($activity->properties) ?: '');
        Notification::assertSentTo($this->user, SecurityChanged::class, fn (SecurityChanged $n): bool => $n->event === $event);
    }

    private function confirmPassword(): void
    {
        $this->as()->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();
    }

    private function as(): static
    {
        return $this->withHeader('Origin', 'http://localhost')->actingAs($this->user, 'web');
    }
}
