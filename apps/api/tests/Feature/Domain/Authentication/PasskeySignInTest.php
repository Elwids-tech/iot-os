<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Authentication\Services\KeptSignInCookie;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\Support\PasskeyFixtures;
use Tests\Support\TwoStepFixtures;
use Tests\Support\VirtualAuthenticator;
use Tests\TestCase;

/** Signing in with a passkey alone (spec 034, US2, FR-017, FR-018). */
final class PasskeySignInTest extends TestCase
{
    use PasskeyFixtures, RefreshDatabase, TwoStepFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
    }

    public function test_the_options_are_kept_in_the_session_and_offer_every_passkey(): void
    {
        $options = $this->signInOptions()->assertOk()->json('options');

        $this->assertSame('localhost', $options['rpId']);
        $this->assertSame('required', $options['userVerification']);
        $this->assertSame([], $options['allowCredentials'] ?? []);
        $this->assertIsString(session('passkey.verification_options'));
        $this->assertStringContainsString($options['challenge'], (string) session('passkey.verification_options'));
    }

    public function test_a_passkey_signs_in_without_a_password_and_records_its_use(): void
    {
        $user = User::factory()->create();
        [$authenticator, $passkey] = $this->givePasskey($user);
        $this->assertNull($passkey->last_used_at);

        $this->signIn($authenticator)->assertOk()->assertJsonPath('data.email', $user->email);

        $this->assertAuthenticatedAs($user, 'web');
        $this->assertNotNull($passkey->refresh()->last_used_at);
        $this->assertNull(session('passkey.verification_options'));
        $this->getJson('/api/v1/me')->assertOk();
    }

    public function test_a_passkey_counts_as_both_steps_and_replaces_a_pending_sign_in(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $this->turnOnTwoStep($user);
        [$authenticator] = $this->givePasskey($user);

        // The password step offers the passkey too.
        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertStatus(202)
            ->assertJsonPath('methods', ['code', 'recovery_code', 'passkey']);
        $this->assertNotNull(session('two_step.pending'));

        $this->signIn($authenticator)->assertOk();

        $this->assertAuthenticatedAs($user, 'web');
        $this->assertNull(session('two_step.pending'));
    }

    public function test_keep_me_signed_in_issues_a_kept_sign_in_not_a_remember_token(): void
    {
        $user = User::factory()->create();
        $token = $user->remember_token;
        [$authenticator] = $this->givePasskey($user);

        $response = $this->signIn($authenticator, remember: true)->assertOk();

        $this->assertNotNull($response->getCookie(KeptSignInCookie::NAME));
        $this->assertTrue(KeptSignIn::query()->sole()->isLive());
        $this->assertSame($token, $user->refresh()->remember_token);
        foreach ($response->headers->getCookies() as $cookie) {
            $this->assertStringNotContainsString('remember_web', $cookie->getName());
        }

        $this->loseSession();
        $this->signIn($authenticator, remember: false)->assertOk()->assertCookieMissing(KeptSignInCookie::NAME);
        $this->assertSame(1, KeptSignIn::query()->count());
    }

    public function test_an_invalid_assertion_is_refused(): void
    {
        $user = User::factory()->create();
        [$authenticator] = $this->givePasskey($user);

        // Signed by a key the API does not know.
        $stranger = new VirtualAuthenticator;
        $stranger->register(['user' => ['id' => 'x'], 'rp' => ['id' => 'localhost'], 'challenge' => 'x']);
        $options = $this->signInOptions()->json('options');
        $this->answer($stranger->assert($options))->assertUnprocessable()->assertJsonValidationErrors('credential');

        // From a site that is not one of the deployment's front ends.
        $options = $this->signInOptions()->json('options');
        $this->answer($authenticator->assert($options, origin: 'https://phishing.example.com'))->assertUnprocessable()->assertJsonValidationErrors('credential');

        // For another challenge than the one this browser was given.
        $this->signInOptions();
        $this->answer($authenticator->assert(['challenge' => 'b3RoZXI', 'rpId' => 'localhost']))->assertUnprocessable();

        // Without asking for options first.
        $this->answer($authenticator->assert($options))->assertUnprocessable()->assertJsonValidationErrors('credential');

        $this->assertGuest('web');
    }

    public function test_a_removed_passkey_no_longer_signs_in(): void
    {
        $user = User::factory()->create();
        [$authenticator, $passkey] = $this->givePasskey($user);
        $passkey->delete();

        $this->signIn($authenticator)->assertUnprocessable()->assertJsonValidationErrors('credential');
        $this->assertGuest('web');
    }

    public function test_both_routes_are_not_found_where_passkeys_cannot_be_used(): void
    {
        config(['passkeys.allowed_origins' => ['http://portal.example.com', 'https://admin.example.com']]);

        $this->signInOptions()->assertNotFound();
        $this->answer(['id' => 'x', 'rawId' => 'x', 'type' => 'public-key', 'response' => []])->assertNotFound();
    }

    public function test_the_seventh_try_in_a_minute_is_refused(): void
    {
        foreach (range(1, 6) as $ignored) {
            $this->signInOptions()->assertOk();
        }

        $this->signInOptions()->assertTooManyRequests();
        $this->answer(['id' => 'x', 'rawId' => 'x', 'type' => 'public-key', 'response' => ['a' => 1]])->assertUnprocessable();

        $this->travel(61)->seconds();
        $this->signInOptions()->assertOk();
    }

    private function signIn(VirtualAuthenticator $authenticator, bool $remember = false): TestResponse
    {
        $options = $this->signInOptions()->assertOk()->json('options');

        return $this->answer($authenticator->assert($options), $remember);
    }

    private function signInOptions(): TestResponse
    {
        return $this->withHeader('Origin', 'http://localhost')->getJson('/api/v1/auth/passkeys/options');
    }

    /**
     * @param  array<string, mixed>  $credential
     */
    private function answer(array $credential, bool $remember = false): TestResponse
    {
        return $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/passkeys', ['credential' => $credential, 'remember' => $remember]);
    }

    private function loseSession(): void
    {
        Auth::forgetGuards();
        $this->flushSession();
        Cookie::flushQueuedCookies();
        $this->defaultCookies = [];
    }
}
