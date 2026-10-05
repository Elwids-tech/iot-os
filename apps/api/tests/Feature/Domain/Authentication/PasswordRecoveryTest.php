<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Authentication\Notifications\PasswordResetNotification;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\ChannelManager;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Tests\TestCase;

final class PasswordRecoveryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
    }

    public function test_request_is_generic_normalized_throttled_and_uses_a_trusted_link(): void
    {
        config(['app.frontend_url' => 'https://app.staging.elwids.xyz']);
        $user = User::factory()->create(['email' => 'recovery@example.test']);
        $known = $this->postJson('/api/v1/auth/forgot-password', ['email' => '  RECOVERY@example.test  '])->assertOk()->json();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'unknown@example.test'])->assertOk()->assertExactJson($known);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertOk()->assertExactJson($known);
        Notification::assertSentToTimes($user, PasswordResetNotification::class, 1);
        $notification = Notification::sent($user, PasswordResetNotification::class)->first();
        $url = $notification->toMail($user)->actionUrl;
        $this->assertStringStartsWith('https://app.staging.elwids.xyz/reset-password#', $url);
        $this->assertNull(parse_url($url, PHP_URL_QUERY));
        $this->assertTrue(Hash::check($notification->token, DB::table('password_reset_tokens')->value('token')));
        $this->assertSame('alerts', $notification->connection);
        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertOk();
        }
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertTooManyRequests();
    }

    public function test_reset_is_single_use_and_revokes_credentials_without_changing_other_users(): void
    {
        config(['session.driver' => 'database']);
        $user = User::factory()->create(['password' => 'original-password', 'remember_token' => 'old-remember-token']);
        $other = User::factory()->create();
        $otherHash = $other->password;
        $user->createToken('old-token');
        foreach ([$user, $other] as $sessionUser) {
            DB::table('sessions')->insert(['id' => 'session-'.$sessionUser->id, 'user_id' => $sessionUser->id, 'payload' => '', 'last_activity' => time()]);
        }
        $token = Password::createToken($user);
        $input = ['email' => $user->email, 'token' => $token, 'password' => 'new-long-password', 'password_confirmation' => 'new-long-password'];
        $this->postJson('/api/v1/auth/reset-password', $input)->assertOk();
        $user->refresh();
        $this->assertTrue(Hash::check('new-long-password', $user->password));
        $this->assertFalse(Hash::check('original-password', $user->password));
        $this->assertNotSame('old-remember-token', $user->remember_token);
        $this->assertSame(0, $user->tokens()->count());
        $this->assertDatabaseMissing('sessions', ['user_id' => $user->id]);
        $this->assertDatabaseHas('sessions', ['user_id' => $other->id]);
        $this->assertSame($otherHash, $other->fresh()->password);
        $this->assertGuest();
        $this->postJson('/api/v1/auth/reset-password', $input)->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'original-password'])->assertUnprocessable();
        $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'new-long-password'])->assertOk();
    }

    public function test_expired_wrong_account_and_invalid_tokens_are_rejected(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $token = Password::createToken($user);
        $input = ['email' => $other->email, 'token' => $token, 'password' => 'new-long-password', 'password_confirmation' => 'new-long-password'];
        $this->postJson('/api/v1/auth/reset-password', $input)->assertUnprocessable()->assertJsonValidationErrors('token');
        $input['email'] = $user->email;
        $input['token'] = 'invalid-token';
        $this->postJson('/api/v1/auth/reset-password', $input)->assertUnprocessable()->assertJsonValidationErrors('token');
        $input['token'] = $token;
        $this->travel(61)->minutes();
        $this->postJson('/api/v1/auth/reset-password', $input)->assertUnprocessable()->assertJsonValidationErrors('token');
    }

    public function test_password_and_request_validation(): void
    {
        $this->postJson('/api/v1/auth/forgot-password', ['email' => ['invalid']])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/auth/reset-password', ['email' => 'test@example.test', 'token' => 'token', 'password' => 'short', 'password_confirmation' => 'different'])
            ->assertUnprocessable()->assertJsonValidationErrors('password');
    }

    public function test_login_initializes_password_fingerprint_and_a_reset_invalidates_it(): void
    {
        $user = User::factory()->create(['password' => 'original-password']);
        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'original-password'])
            ->assertOk()->assertSessionHas('password_hash_web');
        $oldFingerprint = session('password_hash_web');
        // Change the password independently, as a reset in another browser would.
        $user->forceFill(['password' => 'new-long-password'])->save();
        $this->app['auth']->forgetGuards();
        $this->withSession(['password_hash_web' => $oldFingerprint])
            ->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_reset_notification_is_encrypted_in_the_consumed_mail_queue(): void
    {
        Notification::swap(new ChannelManager($this->app));
        $user = User::factory()->create();
        $user->notify(new PasswordResetNotification('secret-reset-bearer-token'));
        $job = DB::table('jobs')->first();
        $this->assertSame('alerts', $job->queue);
        $this->assertStringNotContainsString('secret-reset-bearer-token', $job->payload);
        $command = json_decode($job->payload, true)['data']['command'];
        $this->assertStringContainsString('secret-reset-bearer-token', decrypt($command));
    }
}
