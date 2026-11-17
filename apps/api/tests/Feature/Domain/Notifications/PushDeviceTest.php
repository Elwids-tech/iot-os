<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Notifications;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Tests\Support\PushFixtures;
use Tests\TestCase;

/** Push devices (spec 033, FR-017, FR-020, FR-028, contracts/push-api.md). */
final class PushDeviceTest extends TestCase
{
    use PushFixtures;
    use RefreshDatabase;

    private const DEVICES = '/api/v1/notifications/push/devices';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        $this->enablePush();
        $this->fakePushService();
    }

    public function test_registering_a_browser_turns_push_on_and_never_returns_its_secrets(): void
    {
        $user = $this->signIn(User::factory()->create(['password' => 'password']));
        $subscription = $this->browserSubscription('Safari on iPhone');

        $created = $this->stateful()->postJson(self::DEVICES, $subscription)->assertCreated();
        $again = $this->stateful()->postJson(self::DEVICES, $subscription)->assertOk();

        $device = PushDevice::query()->sole();
        $this->assertSame([$device->uuid, 'Safari on iPhone', null], [$created->json('data.uuid'), $created->json('data.label'), $created->json('data.replaced')]);
        $this->assertSame($device->uuid, $again->json('data.uuid'));
        $this->assertSame($subscription['endpoint'], $device->endpoint);
        $this->assertNotSame($subscription['endpoint'], DB::table('push_devices')->value('endpoint'), 'The endpoint is encrypted at rest.');
        $this->assertSame(session()->getId(), $device->session_id);
        $settings = $this->stateful()->getJson('/api/v1/notifications/push')->assertOk();
        $this->assertSame([true, ['critical' => true, 'warning' => true, 'info' => true, 'recovery' => false]], [$settings->json('data.enabled'), $settings->json('data.levels')]);
        foreach ([$created, $again, $settings] as $response) {
            foreach ([$subscription['endpoint'], $subscription['keys']['p256dh'], $subscription['keys']['auth'], (string) session()->getId()] as $secret) {
                $this->assertStringNotContainsString($secret, $response->getContent());
            }
        }
        $this->assertSame(['uuid', 'label', 'created_at', 'last_reached_at', 'last_failed_at'], array_keys($settings->json('data.devices.0')));
        $this->assertSame($user->id, $device->user_id);
    }

    public function test_registration_is_validated_and_refused_without_a_push_key(): void
    {
        $this->signIn(User::factory()->create(['password' => 'password']));
        $good = $this->browserSubscription();

        $this->stateful()->postJson(self::DEVICES, [...$good, 'endpoint' => 'http://push.example.test/x'])->assertUnprocessable()->assertJsonValidationErrors('endpoint');
        $this->stateful()->postJson(self::DEVICES, [...$good, 'keys' => ['p256dh' => 'x']])->assertUnprocessable()->assertJsonValidationErrors('keys.auth');
        $this->stateful()->postJson(self::DEVICES, [...$good, 'label' => str_repeat('a', 61)])->assertUnprocessable();
        config(['webpush.vapid.public_key' => null]);
        $this->stateful()->postJson(self::DEVICES, $good)->assertStatus(409);
        $this->assertFalse($this->stateful()->getJson('/api/v1/notifications/push')->json('data.available'));
        $this->assertNull($this->stateful()->getJson('/api/v1/notifications/push')->json('data.public_key'));
        $this->assertSame(0, PushDevice::query()->count());
    }

    public function test_an_endpoint_registered_by_someone_else_is_released_to_the_new_person(): void
    {
        $first = User::factory()->create();
        $second = User::factory()->create();
        $subscription = $this->browserSubscription();
        $this->actingAs($first, 'sanctum')->postJson(self::DEVICES, $subscription)->assertCreated();

        $this->actingAs($second, 'sanctum')->postJson(self::DEVICES, $subscription)->assertCreated();

        $this->assertSame($second->id, PushDevice::query()->sole()->user_id);
    }

    public function test_an_eleventh_device_replaces_the_one_unused_longest(): void
    {
        $user = $this->signIn(User::factory()->create(['password' => 'password']));
        foreach (range(1, 10) as $n) {
            $device = $this->pushDevice($user, 'Browser '.$n);
            $device->forceFill(['created_at' => now()->subDays(20 - $n), 'last_reached_at' => $n === 3 ? now() : null])->save();
        }

        $response = $this->stateful()->postJson(self::DEVICES, $this->browserSubscription('Newest'))->assertCreated();

        $this->assertSame(['label' => 'Browser 1'], $response->json('data.replaced'));
        $this->assertSame(10, PushDevice::query()->where('user_id', $user->id)->count());
        $this->assertNotNull(PushDevice::query()->where('label', 'Browser 3')->first(), 'A recently reached device stays.');
    }

    public function test_sync_answers_mine_released_or_unknown(): void
    {
        $owner = User::factory()->create(['password' => 'password']);
        $device = $this->pushDevice($owner);
        $this->signIn($owner);

        $this->stateful()->postJson(self::DEVICES.'/sync', ['endpoint' => $device->endpoint])->assertOk()->assertExactJson(['data' => ['status' => 'mine', 'uuid' => $device->uuid]]);
        $this->assertNotNull($device->fresh()->session_id, 'Sync links the device to the session it came from.');
        $this->stateful()->postJson(self::DEVICES.'/sync', ['endpoint' => 'https://push.example.test/send/nobody'])->assertOk()->assertExactJson(['data' => ['status' => 'unknown', 'uuid' => null]]);
    }

    public function test_sync_releases_a_device_another_person_held(): void
    {
        $device = $this->pushDevice(User::factory()->create());

        $this->actingAs(User::factory()->create(), 'sanctum')->postJson(self::DEVICES.'/sync', ['endpoint' => $device->endpoint])
            ->assertOk()->assertExactJson(['data' => ['status' => 'released', 'uuid' => null]]);

        $this->assertModelMissing($device);
    }

    public function test_removing_a_device_ends_its_kept_sign_in_and_its_session(): void
    {
        config(['session.driver' => 'database']);
        app('session')->forgetDrivers();
        $owner = User::factory()->create(['password' => 'password']);
        $kept = KeptSignIn::issue($owner, 'Safari on iPhone')[0];
        $device = $this->pushDevice($owner, 'Lost phone');
        DB::table('sessions')->insert(['id' => 'lost-phone-session', 'user_id' => $owner->id, 'payload' => base64_encode(serialize([])), 'last_activity' => now()->timestamp]);
        $device->forceFill(['kept_sign_in_id' => $kept->id, 'session_id' => 'lost-phone-session'])->save();
        $this->actingAs($owner, 'sanctum');

        $this->deleteJson(self::DEVICES.'/'.$device->uuid)->assertNoContent();

        $this->assertModelMissing($device);
        $this->assertSame(KeptSignIn::DEVICE_REMOVED, $kept->fresh()->end_reason);
        $this->assertDatabaseMissing('sessions', ['id' => 'lost-phone-session']);
    }

    public function test_only_the_owner_can_remove_or_test_a_device(): void
    {
        $device = $this->pushDevice(User::factory()->create());
        $this->actingAs(User::factory()->create(), 'sanctum');

        $this->deleteJson(self::DEVICES.'/'.$device->uuid)->assertNotFound();
        $this->postJson(self::DEVICES.'/'.$device->uuid.'/test')->assertNotFound();
        $this->deleteJson(self::DEVICES.'/not-a-uuid')->assertNotFound();
        $this->assertModelExists($device);
    }

    public function test_send_test_pushes_to_that_device_and_removes_it_when_gone(): void
    {
        $owner = User::factory()->create();
        $device = $this->pushDevice($owner);
        $this->actingAs($owner, 'sanctum');

        $this->postJson(self::DEVICES.'/'.$device->uuid.'/test')->assertOk()->assertExactJson(['data' => ['status' => 'accepted']]);
        $this->assertArrayNotHasKey('Topic', $this->pushesSent()[0]['headers']);
        $this->fakePushService(410);
        $this->postJson(self::DEVICES.'/'.$device->uuid.'/test')->assertOk()->assertExactJson(['data' => ['status' => 'gone']]);
        $this->assertModelMissing($device);
    }

    public function test_send_test_is_throttled(): void
    {
        $owner = User::factory()->create();
        $device = $this->pushDevice($owner);
        $this->actingAs($owner, 'sanctum');

        foreach (range(1, 6) as $ignored) {
            $this->postJson(self::DEVICES.'/'.$device->uuid.'/test')->assertOk();
        }
        $this->postJson(self::DEVICES.'/'.$device->uuid.'/test')->assertStatus(429);
    }

    public function test_signing_out_removes_this_browsers_device_and_keeps_the_others(): void
    {
        $user = $this->signIn(User::factory()->create(['password' => 'password']));
        $this->stateful()->postJson(self::DEVICES, $this->browserSubscription('This laptop'))->assertCreated();
        $phone = $this->pushDevice($user, 'Phone');

        $this->stateful()->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertSame(['Phone'], PushDevice::query()->pluck('label')->all());
        $this->assertModelExists($phone);
    }

    public function test_a_password_reset_removes_every_device(): void
    {
        Notification::fake();
        $user = User::factory()->create(['password' => 'password']);
        $this->pushDevice($user, 'Phone');
        $this->pushDevice($user, 'Laptop');
        $token = Password::broker()->createToken($user);

        $this->stateful()->postJson('/api/v1/auth/reset-password', ['token' => $token, 'email' => $user->email, 'password' => 'a-new-Password-1', 'password_confirmation' => 'a-new-Password-1'])->assertOk();

        $this->assertSame(0, PushDevice::query()->count());
    }

    private function signIn(User $user): User
    {
        $this->stateful()->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();

        return $user;
    }

    /** A request from the portal, carrying the session cookie back as a browser does. */
    private function stateful(): static
    {
        return $this->withHeaders(['Origin' => 'http://localhost'])->withCredentials()
            ->withCookie(config('session.cookie'), $this->app['session.store']->getId());
    }

    private function loseSession(): void
    {
        Auth::forgetGuards();
        $this->flushSession();
        Cookie::flushQueuedCookies();
        $this->defaultCookies = [];
    }
}
