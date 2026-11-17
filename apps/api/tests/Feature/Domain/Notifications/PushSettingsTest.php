<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Notifications;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Notifications\Models\PushSummary;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\PushFixtures;
use Tests\TestCase;

/** Push levels, the switch and per-organization switches (spec 033, FR-019, contracts/push-api.md). */
final class PushSettingsTest extends TestCase
{
    use PushFixtures;
    use RefreshDatabase;

    private const SETTINGS = '/api/v1/notifications/push';

    private User $member;

    private Organization $acme;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->enablePush();
        $this->actingAs($this->member, 'sanctum');
    }

    public function test_settings_report_availability_levels_organizations_and_devices(): void
    {
        $data = $this->getJson(self::SETTINGS)->assertOk()->json('data');

        $this->assertSame([true, config('webpush.vapid.public_key'), false, null, 0], [$data['available'], $data['public_key'], $data['enabled'], $data['levels'], $data['revision']]);
        $this->assertContains(['uuid' => $this->acme->uuid, 'name' => $this->acme->name, 'enabled' => true], $data['organizations']);
        $this->assertSame([], $data['devices']);
        $this->assertSame(0, DB::table('notification_preferences')->where('user_id', $this->member->id)->count(), 'Reading creates nothing.');

        config(['webpush.vapid.private_key' => '']);
        $this->assertSame([false, null], [$this->getJson(self::SETTINGS)->json('data.available'), $this->getJson(self::SETTINGS)->json('data.public_key')]);
    }

    public function test_levels_save_with_their_own_revision_and_stale_saves_are_refused(): void
    {
        $levels = ['critical' => true, 'warning' => false, 'info' => true, 'recovery' => true];

        $saved = $this->putJson(self::SETTINGS, ['revision' => 0, 'enabled' => true, 'levels' => $levels])->assertOk()->json('data');

        $this->assertSame([true, $levels, 1], [$saved['enabled'], $saved['levels'], $saved['revision']]);
        $this->putJson(self::SETTINGS, ['revision' => 0, 'enabled' => false, 'levels' => $levels])->assertStatus(409);
        $this->putJson(self::SETTINGS, ['revision' => 1, 'enabled' => false, 'levels' => $levels])->assertOk()->assertJsonPath('data.enabled', false);
        // Email preferences keep their own revision.
        $this->assertSame(0, (int) DB::table('notification_preferences')->where('user_id', $this->member->id)->value('revision'));
        $this->getJson('/api/v1/notifications/preferences')->assertOk()->assertJsonPath('data.email_enabled', true);
    }

    public function test_levels_must_be_the_four_booleans(): void
    {
        $this->putJson(self::SETTINGS, ['revision' => 0, 'enabled' => true, 'levels' => ['critical' => true]])->assertUnprocessable();
        $this->putJson(self::SETTINGS, ['revision' => 0, 'enabled' => true, 'levels' => ['critical' => true, 'warning' => true, 'info' => true, 'recovery' => 'yes']])->assertUnprocessable();
        $this->putJson(self::SETTINGS, ['revision' => 0, 'enabled' => true, 'levels' => ['critical' => true, 'warning' => true, 'info' => true, 'recovery' => true, 'debug' => true]])->assertUnprocessable();
    }

    public function test_an_organization_can_be_switched_off_and_on_by_its_members_only(): void
    {
        $url = self::SETTINGS.'/organizations/'.$this->acme->uuid;

        $this->putJson($url, ['enabled' => false])->assertOk();
        $this->putJson($url, ['enabled' => false])->assertOk(); // idempotent

        $this->assertContains(['uuid' => $this->acme->uuid, 'name' => $this->acme->name, 'enabled' => false], $this->getJson(self::SETTINGS)->json('data.organizations'));
        $this->assertSame(1, DB::table('push_organization_mutes')->count());
        $this->putJson($url, ['enabled' => true])->assertOk();
        $this->assertSame(0, DB::table('push_organization_mutes')->count());

        $other = Organization::where('slug', '!=', 'acme-manufacturing')->whereDoesntHave('users', fn ($users) => $users->whereKey($this->member->id))->firstOrFail();
        $this->putJson(self::SETTINGS.'/organizations/'.$other->uuid, ['enabled' => false])->assertNotFound();
        $this->assertSame(0, DB::table('push_organization_mutes')->count());
    }

    public function test_a_member_without_device_view_cannot_switch_the_organization(): void
    {
        Role::where('organization_id', $this->acme->id)->where('name', OrganizationRoleName::MEMBER->value)->firstOrFail()
            ->revokePermissionTo(DevicePermission::VIEW->value);

        $this->putJson(self::SETTINGS.'/organizations/'.$this->acme->uuid, ['enabled' => false])->assertNotFound();

        $this->assertSame(0, DB::table('push_organization_mutes')->count());
        $this->assertNotContains($this->acme->uuid, array_column($this->getJson(self::SETTINGS)->json('data.organizations'), 'uuid'));
    }

    public function test_switches_summaries_and_devices_go_with_their_organization_or_person(): void
    {
        // The foreign keys cascade, so deleting an organization or a person needs no cleanup code.
        $foreignKeys = collect(DB::select("select tc.table_name, rc.delete_rule from information_schema.referential_constraints rc join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name where tc.table_name in ('push_organization_mutes', 'push_summaries', 'push_devices')"));
        $this->assertTrue($foreignKeys->where('table_name', 'push_organization_mutes')->every(fn ($fk) => $fk->delete_rule === 'CASCADE'));
        $this->assertTrue($foreignKeys->where('table_name', 'push_summaries')->every(fn ($fk) => $fk->delete_rule === 'CASCADE'));
        $this->assertSame(['CASCADE', 'SET NULL'], $foreignKeys->where('table_name', 'push_devices')->pluck('delete_rule')->sort()->values()->all());
    }

    public function test_a_restored_copy_forgets_every_device_and_pending_summary(): void
    {
        $this->pushDevice($this->member);
        $summary = PushSummary::query()->create(['user_id' => $this->member->id, 'organization_id' => $this->acme->id, 'window_started_at' => now(), 'window_ends_at' => now()->addMinute()]);
        config(['deployment.recovery_mode' => true]);
        // The command also quarantines the runtime's commands; the API test database has no runtime schema.
        DB::statement('create schema if not exists device_runtime');
        DB::statement('create table if not exists device_runtime.commands (status text, expires_at timestamptz, diagnostic text)');

        $this->artisan('deployment:quarantine-restore')->assertSuccessful();

        $this->assertSame(0, PushDevice::query()->count());
        $this->assertSame('failed', $summary->fresh()->status);
    }

    public function test_old_summaries_are_pruned_with_the_bells_notifications(): void
    {
        $old = PushSummary::query()->create(['user_id' => $this->member->id, 'organization_id' => $this->acme->id, 'window_started_at' => now()->subDays(91), 'window_ends_at' => now()->subDays(91), 'status' => 'sent']);
        $old->forceFill(['created_at' => now()->subDays(91)])->save();
        $recent = PushSummary::query()->create(['user_id' => $this->member->id, 'organization_id' => $this->acme->id, 'window_started_at' => now()->subDays(89), 'window_ends_at' => now()->subDays(89), 'status' => 'sent']);
        $recent->forceFill(['created_at' => now()->subDays(89)])->save();

        $this->artisan('alerts:prune-notifications')->expectsOutput('Pruned 1 push summaries.')->assertSuccessful();

        $this->assertModelMissing($old);
        $this->assertModelExists($recent);
    }
}
