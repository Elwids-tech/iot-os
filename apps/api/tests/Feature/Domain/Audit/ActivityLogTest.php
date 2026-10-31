<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Audit;

use App\Domain\Audit\Models\Activity;
use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class ActivityLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_records_the_actor_organization_subject_and_changes(): void
    {
        $organization = Organization::factory()->create();
        $actor = User::factory()->create();
        $site = Site::query()->create(['organization_id' => $organization->id, 'name' => 'North yard', 'timezone' => 'UTC']);

        ActivityLog::record('site.updated', $organization, $actor, $site, ['note' => 'moved'], ActivityChanges::between(['name' => 'Yard', 'timezone' => 'UTC'], ['name' => 'North yard', 'timezone' => 'UTC']));

        $activity = Activity::query()->sole();
        $this->assertSame('site.updated', $activity->event);
        $this->assertSame('audit', $activity->log_name);
        $this->assertSame($organization->id, $activity->organization_id);
        $this->assertSame($actor->id, (int) $activity->causer_id);
        $this->assertTrue($activity->causer->is($actor));
        $this->assertTrue($activity->subject->is($site));
        $this->assertSame($site->uuid, $activity->subject_uuid);
        $this->assertSame('North yard', $activity->subject_name);
        $this->assertSame(['note' => 'moved'], $activity->properties->toArray());
        $this->assertSame(['attributes' => ['name' => 'North yard'], 'old' => ['name' => 'Yard']], $activity->attribute_changes->toArray());
    }

    public function test_a_system_event_never_takes_the_signed_in_user(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum');

        DeviceAudit::record('alert.raised', null, null, (string) Str::uuid(), ['episode' => 1]);

        $activity = Activity::query()->sole();
        $this->assertNull($activity->causer_id);
        $this->assertNull($activity->causer_type);
        $this->assertNull($activity->attribute_changes);
    }

    public function test_an_actor_id_is_kept_without_loading_the_user(): void
    {
        $actor = User::factory()->create();
        DB::enableQueryLog();

        DeviceAudit::record('device.updated', null, $actor->id, null);

        $this->assertSame([], array_filter(DB::getQueryLog(), fn (array $query): bool => str_contains($query['query'], 'from "users"')));
        $this->assertSame($actor->id, (int) Activity::query()->sole()->causer_id);
        $this->assertSame((new User)->getMorphClass(), Activity::query()->sole()->causer_type);
    }

    public function test_secret_looking_fields_are_never_kept(): void
    {
        ActivityLog::record('application.token_rotated', null, null, null, [
            'token' => 'plain-token',
            'secret_uuid' => 'kept',
            'nested' => ['client_secret' => 'x', 'password' => 'y', 'label' => 'kept'],
        ], ActivityChanges::between(['api_key' => 'a', 'name' => 'Old'], ['api_key' => 'b', 'name' => 'New']));

        $activity = Activity::query()->sole();
        $this->assertSame(['secret_uuid' => 'kept', 'nested' => ['label' => 'kept']], $activity->properties->toArray());
        $this->assertSame(['attributes' => ['name' => 'New'], 'old' => ['name' => 'Old']], $activity->attribute_changes->toArray());
        $this->assertStringNotContainsString('plain-token', json_encode(DB::table('activity_log')->get()));
    }

    public function test_an_event_rolls_back_with_its_change(): void
    {
        try {
            DB::transaction(function (): void {
                ActivityLog::record('site.created', null, null, (string) Str::uuid());
                throw new \RuntimeException('rolled back');
            });
        } catch (\RuntimeException) {
        }

        $this->assertSame(0, Activity::query()->count());
    }

    public function test_the_migration_copies_every_old_event_in_order(): void
    {
        $migration = require database_path('migrations/2026_10_31_120000_create_activity_log.php');
        $organization = Organization::factory()->create();
        $actor = User::factory()->create();
        $migration->down();

        $resource = (string) Str::uuid();
        DB::table('device_audit_events')->insert([
            ['uuid' => (string) Str::uuid(), 'organization_id' => $organization->id, 'actor_id' => $actor->id, 'resource_uuid' => $resource, 'action' => 'device.updated', 'details' => '{"field":"name"}', 'created_at' => '2026-10-01 10:00:00'],
            ['uuid' => (string) Str::uuid(), 'organization_id' => null, 'actor_id' => null, 'resource_uuid' => null, 'action' => 'alert.raised', 'details' => '[]', 'created_at' => '2026-10-01 09:00:00'],
        ]);

        $migration->up();

        $rows = DB::table('activity_log')->orderBy('id')->get();
        $this->assertCount(2, $rows);
        $this->assertSame(['device.updated', 'alert.raised'], $rows->pluck('event')->all());
        $this->assertSame((new User)->getMorphClass(), $rows[0]->causer_type);
        $this->assertSame($actor->id, (int) $rows[0]->causer_id);
        $this->assertSame($organization->id, (int) $rows[0]->organization_id);
        $this->assertSame($resource, $rows[0]->subject_uuid);
        $this->assertSame(['field' => 'name'], json_decode($rows[0]->properties, true));
        $this->assertStringStartsWith('2026-10-01 10:00:00', (string) $rows[0]->created_at);
        $this->assertNull($rows[1]->causer_type);
        $this->assertNull($rows[1]->causer_id);
        $this->assertFalse(DB::getSchemaBuilder()->hasTable('device_audit_events'));
    }
}
