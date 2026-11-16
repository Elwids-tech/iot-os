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
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/** Keep me signed in (spec 033, FR-011a, research R11). */
final class KeptSignInTest extends TestCase
{
    use RefreshDatabase;

    private const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

    private const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
    }

    public function test_signing_in_with_remember_sets_the_cookie_and_a_live_record_and_without_it_neither(): void
    {
        $user = User::factory()->create(['password' => 'password']);

        $response = $this->signIn($user, remember: true)->assertOk();

        $record = KeptSignIn::query()->sole();
        $cookie = $response->getCookie(KeptSignInCookie::NAME);
        $this->assertNotNull($cookie);
        [$uuid, $secret] = explode('.', (string) $cookie->getValue());
        $this->assertSame($record->uuid, $uuid);
        $this->assertSame(hash('sha256', $secret), $record->secret_hash);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
        $this->assertEqualsWithDelta(now()->addDays(30)->getTimestamp(), $cookie->getExpiresTime(), 5);
        $this->assertSame($user->id, $record->user_id);
        $this->assertSame('Chrome on Android', $record->label);
        $this->assertTrue($record->isLive());
        $this->assertTrue($record->created_at->addDays(30)->equalTo($record->expires_at));
        $this->assertNull($record->last_used_at);
        $this->assertSame($record->id, session(KeptSignInCookie::SESSION_KEY));

        $this->loseSession();
        $this->signIn($user, remember: false)->assertOk()->assertCookieMissing(KeptSignInCookie::NAME);
        $this->loseSession();
        $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertOk()->assertCookieMissing(KeptSignInCookie::NAME);
        $this->assertSame(1, KeptSignIn::query()->count());
        $this->assertNull(session(KeptSignInCookie::SESSION_KEY));
    }

    public function test_remember_must_be_a_boolean(): void
    {
        $user = User::factory()->create(['password' => 'password']);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password', 'remember' => 'always'])
            ->assertUnprocessable()->assertJsonValidationErrors('remember');
        $this->assertGuest('web');
    }

    public function test_a_request_with_only_the_cookie_resumes_and_stamps_last_used_at_at_most_once_a_minute(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $kept = $this->keptCookie($this->signIn($user));
        $record = KeptSignIn::query()->sole();

        $this->loseSession();
        $this->travel(3)->hours();
        $this->withKept($kept)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email', $user->email);

        $this->assertAuthenticatedAs($user, 'web');
        $this->assertSame($record->id, session(KeptSignInCookie::SESSION_KEY));
        $this->assertSame(Auth::guard('web')->hashPasswordForCookie($user->getAuthPassword()), session('password_hash_web'));
        $stamped = $record->fresh()->last_used_at;
        $this->assertNotNull($stamped);
        $this->assertEqualsWithDelta(now()->getTimestamp(), $stamped->getTimestamp(), 1);

        $this->travel(30)->seconds();
        $this->withKept($kept)->getJson('/api/v1/me')->assertOk();
        $this->assertTrue($record->fresh()->last_used_at->equalTo($stamped));

        $this->travel(2)->minutes();
        $this->withKept($kept)->getJson('/api/v1/me')->assertOk();
        $this->assertTrue($record->fresh()->last_used_at->gt($stamped));
    }

    public function test_an_expired_record_does_not_resume_and_use_never_extends_it(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $kept = $this->keptCookie($this->signIn($user));
        $expiresAt = KeptSignIn::query()->sole()->expires_at;

        $this->travel(29)->days();
        $this->loseSession();
        $this->withKept($kept)->getJson('/api/v1/me')->assertOk();
        $this->assertTrue(KeptSignIn::query()->sole()->expires_at->equalTo($expiresAt));

        // The session resumed on day 29 ends with its record on day 30.
        $this->travel(1)->days();
        $this->travel(1)->minutes();
        $this->withKept($kept)->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertGuest('web');

        $this->loseSession();
        $this->withKept($kept)->getJson('/api/v1/me')->assertUnauthorized()->assertCookieExpired(KeptSignInCookie::NAME);
        $this->assertGuest('web');
    }

    public function test_a_wrong_secret_another_users_uuid_or_a_malformed_cookie_does_not_resume(): void
    {
        $first = User::factory()->create(['password' => 'password']);
        $second = User::factory()->create(['password' => 'password']);
        [, $firstSecret] = explode('.', $this->keptCookie($this->signIn($first)));
        $this->loseSession();
        [$secondUuid] = explode('.', $this->keptCookie($this->signIn($second)));

        foreach ([$secondUuid.'.'.$firstSecret, $secondUuid.'.'.Str::random(64), 'not-a-uuid.'.$firstSecret, $secondUuid, ''] as $forged) {
            $this->loseSession();
            $this->withKept($forged)->getJson('/api/v1/me')->assertUnauthorized();
            $this->assertGuest('web');
        }
        $this->assertSame(2, KeptSignIn::query()->live()->whereNull('last_used_at')->count());
    }

    public function test_an_ended_record_signs_its_session_out_on_the_next_request(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $kept = $this->keptCookie($this->signIn($user));
        $this->withKept($kept)->getJson('/api/v1/me')->assertOk();

        KeptSignIn::query()->sole()->end(KeptSignIn::DEVICE_REMOVED);

        $this->withKept($kept)->getJson('/api/v1/me')->assertUnauthorized()->assertCookieExpired(KeptSignInCookie::NAME);
        $this->assertGuest('web');
        $this->assertNull(session(KeptSignInCookie::SESSION_KEY));
        $this->assertSame(KeptSignIn::DEVICE_REMOVED, KeptSignIn::query()->sole()->end_reason);
    }

    public function test_signing_out_ends_only_that_browsers_kept_sign_in(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $laptop = $this->keptCookie($this->signIn($user));
        $this->loseSession();
        $phone = $this->keptCookie($this->signIn($user, agent: self::IPHONE_SAFARI));
        [$laptopRecord, $phoneRecord] = [$this->recordOf($laptop), $this->recordOf($phone)];
        $this->assertSame('Safari on iPhone', $phoneRecord->label);

        $this->withKept($phone)->postJson('/api/v1/auth/logout')->assertOk()->assertCookieExpired(KeptSignInCookie::NAME);

        $this->assertSame(KeptSignIn::SIGNED_OUT, $phoneRecord->fresh()->end_reason);
        $this->assertNotNull($phoneRecord->fresh()->ended_at);
        $this->assertTrue($laptopRecord->fresh()->isLive());
        $this->loseSession();
        $this->withKept($phone)->getJson('/api/v1/me')->assertUnauthorized();
        $this->loseSession();
        $this->withKept($laptop)->getJson('/api/v1/me')->assertOk();
        $this->assertAuthenticatedAs($user, 'web');
    }

    public function test_signing_in_again_replaces_this_browsers_kept_sign_in(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $kept = $this->keptCookie($this->signIn($user));
        $this->loseSession();

        $this->withKept($kept)->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertOk()->assertCookieExpired(KeptSignInCookie::NAME);

        $this->assertSame(KeptSignIn::SIGNED_OUT, $this->recordOf($kept)->end_reason);
        $this->assertNull(session(KeptSignInCookie::SESSION_KEY));
        $this->getJson('/api/v1/me')->assertOk();
    }

    public function test_a_password_reset_ends_every_kept_sign_in_of_that_person(): void
    {
        Notification::fake();
        $user = User::factory()->create(['password' => 'password']);
        $other = User::factory()->create(['password' => 'password']);
        $laptop = $this->keptCookie($this->signIn($user));
        $this->loseSession();
        $phone = $this->keptCookie($this->signIn($user, agent: self::IPHONE_SAFARI));
        $this->loseSession();
        $others = $this->keptCookie($this->signIn($other));
        $this->loseSession();

        $this->postJson('/api/v1/auth/reset-password', [
            'email' => $user->email, 'token' => Password::createToken($user),
            'password' => 'new-long-password', 'password_confirmation' => 'new-long-password',
        ])->assertOk();

        foreach ([$laptop, $phone] as $kept) {
            $this->assertSame(KeptSignIn::PASSWORD_RESET, $this->recordOf($kept)->end_reason);
            $this->loseSession();
            $this->withKept($kept)->getJson('/api/v1/me')->assertUnauthorized();
        }
        $this->assertTrue($this->recordOf($others)->isLive());
        $this->loseSession();
        $this->withKept($others)->getJson('/api/v1/me')->assertOk();
    }

    public function test_token_and_non_frontend_requests_ignore_the_cookie(): void
    {
        $user = User::factory()->create(['password' => 'password']);
        $kept = $this->keptCookie($this->signIn($user));

        $this->loseSession();
        $this->withKept($kept)->withToken('passport-access-token')->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertGuest('web');

        $this->loseSession();
        $this->withoutToken()->withKept($kept)->withoutHeader('Origin')->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertGuest('web');

        $this->assertNull(KeptSignIn::query()->sole()->last_used_at);
    }

    public function test_the_prune_deletes_rows_ended_or_expired_more_than_30_days_ago(): void
    {
        $user = User::factory()->create();
        $make = function (string $label, ?int $endedDaysAgo = null, ?int $expiredDaysAgo = null) use ($user): KeptSignIn {
            [$record] = KeptSignIn::issue($user, $label);
            $record->forceFill(array_filter([
                'ended_at' => $endedDaysAgo === null ? null : now()->subDays($endedDaysAgo),
                'end_reason' => $endedDaysAgo === null ? null : KeptSignIn::SIGNED_OUT,
                'expires_at' => $expiredDaysAgo === null ? null : now()->subDays($expiredDaysAgo),
            ]))->save();

            return $record;
        };
        $make('ended 31 days ago', endedDaysAgo: 31);
        $make('expired 31 days ago', expiredDaysAgo: 31);
        $keep = [
            $make('ended 29 days ago', endedDaysAgo: 29),
            $make('expired 29 days ago', expiredDaysAgo: 29),
            $make('live'),
        ];

        $this->artisan('auth:prune-kept-sign-ins')->expectsOutput('Pruned 2 kept sign-ins.')->assertSuccessful();

        $this->assertEqualsCanonicalizing(
            array_map(fn (KeptSignIn $record) => $record->id, $keep),
            KeptSignIn::query()->pluck('id')->all(),
        );
    }

    private function signIn(User $user, bool $remember = true, string $agent = self::ANDROID_CHROME): TestResponse
    {
        return $this->withHeaders(['Origin' => 'http://localhost', 'User-Agent' => $agent])
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password', 'remember' => $remember])
            ->assertOk();
    }

    private function keptCookie(TestResponse $response): string
    {
        $cookie = $response->getCookie(KeptSignInCookie::NAME);
        $this->assertNotNull($cookie, 'The sign-in set no iot_kept cookie.');

        return (string) $cookie->getValue();
    }

    private function recordOf(string $kept): KeptSignIn
    {
        return KeptSignIn::query()->where('uuid', Str::before($kept, '.'))->sole();
    }

    /** A request from the portal carrying only the kept cookie. */
    private function withKept(string $kept): static
    {
        $this->defaultCookies = [];

        return $this->withCredentials()->withHeader('Origin', 'http://localhost')->withCookie(KeptSignInCookie::NAME, $kept);
    }

    /** The browser lost its session cookie (idle timeout); the kept cookie, if any, stays. */
    private function loseSession(): void
    {
        Auth::forgetGuards();
        $this->flushSession();
        Cookie::flushQueuedCookies();
        $this->defaultCookies = [];
    }
}
