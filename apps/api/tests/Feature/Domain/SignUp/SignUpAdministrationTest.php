<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\SignUp;

use App\Domain\Audit\Models\Activity;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\SignUp\Models\SignUp;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\PushFixtures;
use Tests\TestCase;

/** Sign-up settings and the sign-up list in the admin app (spec 035 US4, FR-024 to FR-029). */
final class SignUpAdministrationTest extends TestCase
{
    use PushFixtures, RefreshDatabase, SignsUp;

    private User $superAdmin;

    private User $platformAdministrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->setUpSignUp(open: false);
        $this->superAdmin = User::factory()->create(['is_super_admin' => true]);
        $this->platformAdministrator = User::factory()->create();
        $this->platformAdministrator->platformRoles()->attach(PlatformRole::query()->where('key', 'platform-administrator')->firstOrFail());
    }

    public function test_super_administrators_read_the_defaults_and_save_with_the_revision(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/v1/me')
            ->assertJsonPath('data.capabilities.manage_sign_up', true);

        $settings = $this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/v1/admin/sign-up-settings')->assertOk()
            ->assertJsonPath('data.open', false)
            ->assertJsonPath('data.free_beta', true)
            ->assertJsonPath('data.notify_push', true)
            ->assertJsonPath('data.notify_email', false)
            ->assertJsonPath('data.daily_limit', 50)
            ->assertJsonPath('data.updated_by', null)
            ->assertJsonPath('data.my_push_devices', 0)
            ->assertJsonPath('data.today', ['started' => 0, 'limit' => 50])
            ->json('data');

        $saved = $this->actingAs($this->superAdmin, 'sanctum')->putJson('/api/v1/admin/sign-up-settings', [
            'open' => true, 'free_beta' => true, 'notify_push' => false, 'notify_email' => true, 'daily_limit' => 20,
            'revision' => $settings['revision'],
        ])->assertOk()
            ->assertJsonPath('data.open', true)
            ->assertJsonPath('data.notify_push', false)
            ->assertJsonPath('data.notify_email', true)
            ->assertJsonPath('data.daily_limit', 20)
            ->assertJsonPath('data.revision', $settings['revision'] + 1)
            ->assertJsonPath('data.updated_by', ['user_id' => $this->superAdmin->getKey(), 'name' => $this->superAdmin->name])
            ->json('data');

        $entry = Activity::query()->where('event', 'sign_up_settings.updated')->sole();
        $this->assertSame($this->superAdmin->getKey(), (int) $entry->causer_id);
        $this->assertNull($entry->organization_id);
        $this->assertSameJsonDocument([
            'open' => ['from' => false, 'to' => true],
            'notify_push' => ['from' => true, 'to' => false],
            'notify_email' => ['from' => false, 'to' => true],
            'daily_limit' => ['from' => 50, 'to' => 20],
        ], $entry->properties['changes']);

        // A save from the old read is refused.
        $this->actingAs($this->superAdmin, 'sanctum')->putJson('/api/v1/admin/sign-up-settings', [
            'open' => false, 'free_beta' => true, 'notify_push' => true, 'notify_email' => false, 'daily_limit' => 50,
            'revision' => $settings['revision'],
        ])->assertConflict();
        $this->assertSame($saved['revision'], $this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/v1/admin/sign-up-settings')->json('data.revision'));

        // Open now: the public page sees it at once (SC-007).
        $this->portal()->getJson('/api/v1/sign-up')->assertJsonPath('open', true);
    }

    public function test_the_settings_say_what_can_work_here(): void
    {
        config(['webpush.vapid.public_key' => null, 'mail.default' => 'log']);
        $this->pushDevice($this->superAdmin);

        $this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/v1/admin/sign-up-settings')->assertOk()
            ->assertJsonPath('data.push_available', false)
            ->assertJsonPath('data.mail_available', false)
            ->assertJsonPath('data.my_push_devices', 1);
    }

    public function test_only_super_administrators_change_sign_up_and_input_is_checked(): void
    {
        $member = User::factory()->create();
        $values = ['open' => true, 'free_beta' => true, 'notify_push' => true, 'notify_email' => false, 'daily_limit' => 10, 'revision' => 1];

        foreach ([$this->platformAdministrator, $member] as $user) {
            $this->actingAs($user, 'sanctum')->getJson('/api/v1/me')->assertJsonPath('data.capabilities.manage_sign_up', false);
            $this->actingAs($user, 'sanctum')->getJson('/api/v1/admin/sign-up-settings')->assertForbidden();
            $this->actingAs($user, 'sanctum')->putJson('/api/v1/admin/sign-up-settings', $values)->assertForbidden();
        }
        $this->anotherBrowser();
        $this->getJson('/api/v1/admin/sign-up-settings')->assertUnauthorized();

        $this->actingAs($this->superAdmin, 'sanctum')->putJson('/api/v1/admin/sign-up-settings', [...$values, 'daily_limit' => 0, 'open' => 'yes'])
            ->assertUnprocessable()->assertJsonValidationErrors(['daily_limit', 'open']);
        $this->assertFalse((bool) DB::table('sign_up_settings')->value('open'));
    }

    public function test_the_list_shows_each_sign_up_with_its_state_to_those_who_manage_organizations(): void
    {
        $organization = Organization::factory()->create(['name' => 'Done Ltd']);
        $make = fn (array $values) => SignUp::query()->forceCreate([
            'uuid' => fake()->uuid(), 'name' => 'Someone', 'organization_name' => 'Org', 'state' => 'waiting',
            'password' => 'hash', 'token_hash' => hash('sha256', fake()->uuid()), 'token_expires_at' => now()->addDay(),
            ...$values,
        ]);
        $make(['email' => 'waiting@example.com', 'created_at' => now()->subMinutes(4)]);
        $make(['email' => 'expired@example.com', 'token_expires_at' => now()->subMinute(), 'created_at' => now()->subMinutes(3)]);
        $make(['email' => 'done@example.com', 'state' => 'completed', 'password' => null, 'organization_id' => $organization->getKey(), 'completed_at' => now(), 'created_at' => now()->subMinutes(2)]);
        $make(['email' => 'bot@example.com', 'state' => 'refused', 'refusal_reason' => 'honeypot', 'password' => null, 'token_hash' => null, 'created_at' => now()->subMinute()]);

        $all = $this->actingAs($this->platformAdministrator, 'sanctum')->getJson('/api/v1/admin/sign-ups')->assertOk()
            ->assertJsonPath('meta.total', 4)
            ->json('data');
        $this->assertSame(['bot@example.com', 'done@example.com', 'expired@example.com', 'waiting@example.com'], array_column($all, 'email'));
        $this->assertSame(['refused', 'completed', 'expired', 'waiting'], array_column($all, 'state'));
        $this->assertSame(['uuid' => $organization->uuid, 'name' => 'Done Ltd'], $all[1]['organization']);
        $this->assertSame('honeypot', $all[0]['refusal_reason']);
        foreach ($all as $row) {
            $this->assertArrayNotHasKey('password', $row);
            $this->assertArrayNotHasKey('token_hash', $row);
        }

        foreach (['waiting' => 'waiting@example.com', 'expired' => 'expired@example.com', 'completed' => 'done@example.com', 'refused' => 'bot@example.com'] as $state => $email) {
            $this->actingAs($this->superAdmin, 'sanctum')->getJson("/api/v1/admin/sign-ups?state={$state}")->assertOk()
                ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', $email);
        }
        $this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/v1/admin/sign-ups?search=DONE')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'done@example.com');

        $this->actingAs(User::factory()->create(), 'sanctum')->getJson('/api/v1/admin/sign-ups')->assertForbidden();
    }

    public function test_pruning_removes_unconfirmed_after_seven_days_and_refused_after_thirty(): void
    {
        $make = fn (string $email, string $state, int $daysAgo) => SignUp::query()->forceCreate([
            'uuid' => fake()->uuid(), 'name' => 'Someone', 'email' => $email, 'organization_name' => 'Org', 'state' => $state,
            'password' => $state === 'refused' ? null : 'hash', 'created_at' => now()->subDays($daysAgo),
        ]);
        $make('old-waiting@example.com', 'waiting', 8);
        $make('new-waiting@example.com', 'waiting', 6);
        $make('old-refused@example.com', 'refused', 31);
        $make('new-refused@example.com', 'refused', 29);
        $make('done@example.com', 'completed', 90);

        $this->artisan('sign-ups:prune')->assertSuccessful();

        $this->assertSame(
            ['done@example.com', 'new-refused@example.com', 'new-waiting@example.com'],
            SignUp::query()->orderBy('email')->pluck('email')->all(),
        );
        $this->assertNull(SignUp::query()->where('email', 'done@example.com')->value('password'));
    }
}
