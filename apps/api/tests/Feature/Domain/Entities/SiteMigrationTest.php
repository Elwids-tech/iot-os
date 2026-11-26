<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Integrations\Services\ApplicationGrant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Spec 009 US3, FR-014, SC-002: sites become entities and nothing that read them notices.
 * Built on the schema before the migration, then migrated, compared, rolled back and
 * migrated again; T075's drop of the old table is rolled back first and applied last.
 */
final class SiteMigrationTest extends EntityTestCase
{
    private const MIGRATION = 'database/migrations/2026_12_08_000200_sites_become_entities.php';

    private const DROP = 'database/migrations/2026_12_10_000100_drop_legacy_sites.php';

    public function test_sites_become_entities_with_the_same_identity_time_zones_and_grants(): void
    {
        $this->assertFalse(Schema::hasTable('legacy_sites'));
        $this->artisan('migrate:rollback', ['--path' => self::DROP])->assertSuccessful();
        $this->artisan('migrate:rollback', ['--path' => self::MIGRATION])->assertSuccessful();
        $this->assertTrue(Schema::hasTable('sites'));
        $this->organization->forceFill(['timezone' => 'America/Toronto'])->save();

        $berlin = $this->legacySite('Riverside plant', 'Europe/Berlin', ['address' => 'Example Road 1', 'latitude' => 52.52, 'longitude' => 13.405]);
        $plantA = $this->legacySite('Plant A', 'Asia/Tokyo');
        $plantDashA = $this->legacySite('Plant-A', 'UTC');
        $active = $this->legacyDevice('active-1', $berlin);
        $archived = $this->legacyDevice('archived-1', $berlin, 'archived');
        $tokyo = $this->legacyDevice('tokyo-1', $plantA);
        $loose = $this->legacyDevice('loose-1', null);
        $expectedZones = ['active-1' => 'Europe/Berlin', 'archived-1' => 'Europe/Berlin', 'tokyo-1' => 'Asia/Tokyo', 'loose-1' => 'America/Toronto'];
        $grantBefore = $this->resolvedGrant([$this->legacyUuid($berlin), $this->legacyUuid($plantA)]);
        // What the sites API served before: the rows, by name, with their device counts.
        $sitesBefore = DB::table('sites')->where('organization_id', $this->organization->id)->orderBy('name')->get()->map(fn ($site) => [
            'uuid' => $site->uuid, 'name' => $site->name, 'timezone' => $site->timezone, 'address' => $site->address,
            'latitude' => $site->latitude === null ? null : (float) $site->latitude, 'longitude' => $site->longitude === null ? null : (float) $site->longitude,
            'devices_count' => DB::table('devices')->where('site_id', $site->id)->count(),
        ])->all();

        $this->artisan('migrate', ['--path' => self::MIGRATION])->assertSuccessful();

        $this->assertFalse(Schema::hasTable('sites'));
        $this->assertTrue(Schema::hasTable('legacy_sites'));
        foreach ([$berlin, $plantA, $plantDashA] as $siteId) {
            $legacy = DB::table('legacy_sites')->find($siteId);
            $entity = Entity::with('type')->where('uuid', $legacy->uuid)->sole();
            $this->assertSame(['site', null, 0, $legacy->name, $legacy->timezone, $legacy->address], [$entity->type->key, $entity->parent_id, $entity->depth, $entity->name, $entity->timezone, $entity->address]);
        }
        $this->assertSame(['PlantA', 'Site1'], [Entity::where('name', 'Plant A')->value('path_name'), Entity::where('name', 'Plant-A')->value('path_name')], 'a clashing path name gets Site<n>');
        foreach ($expectedZones as $code => $zone) {
            $this->assertSame($zone, Device::where('code', $code)->firstOrFail()->reportingTimezone(), $code);
        }
        $berlinEntity = Entity::where('uuid', $this->legacyUuid($berlin))->value('id');
        $this->assertSame([$berlinEntity, $berlinEntity], [Device::find($active)->site_id, Device::find($active)->entity_id]);
        $this->assertNull(EntityPlacement::where('device_id', $active)->sole()->started_at, 'since before placement history was kept');
        $this->assertNull(EntityPlacement::where('device_id', $active)->sole()->ended_at);
        $this->assertSame(EntityPlacement::DEVICE_ARCHIVED, EntityPlacement::where('device_id', $archived)->sole()->end_reason);
        $this->assertSame($berlinEntity, Device::find($archived)->entity_id, 'an archived device keeps its site as its anchor');
        $this->assertNull(Device::find($loose)->entity_id);
        $this->assertSame($grantBefore, $this->resolvedGrant([$this->legacyUuid($berlin), $this->legacyUuid($plantA)]));
        $this->assertSame($sitesBefore, $this->getJson($this->prefix.'/sites')->assertOk()->json('data'));
        $this->assertSame(['active-1', 'archived-1'], collect($this->getJson($this->prefix.'/devices?per_page=100&lifecycle=&site_uuid='.$this->legacyUuid($berlin))->json('data'))->pluck('code')->sort()->values()->all());
        $this->getJson($this->prefix.'/devices/'.Device::find($tokyo)->uuid)->assertOk()->assertJsonPath('data.site.uuid', $this->legacyUuid($plantA))->assertJsonPath('data.reporting_timezone', 'Asia/Tokyo');

        // Back, then forward again: the rollback restores the sites and their devices.
        $this->artisan('migrate:rollback', ['--path' => self::MIGRATION])->assertSuccessful();
        $this->assertSame($berlin, (int) DB::table('devices')->where('id', $active)->value('site_id'));
        $this->assertSame(0, DB::table('entities')->where('uuid', $this->legacyUuid($berlin))->count());
        $this->artisan('migrate', ['--path' => self::MIGRATION])->assertSuccessful();
        $this->assertSame($grantBefore, $this->resolvedGrant([$this->legacyUuid($berlin), $this->legacyUuid($plantA)]));

        // T075: the old table goes; rolling the drop back rebuilds it from the Site entities.
        $this->artisan('migrate', ['--path' => self::DROP])->assertSuccessful();
        $this->assertFalse(Schema::hasTable('legacy_sites'));
        $this->assertSame($sitesBefore, $this->getJson($this->prefix.'/sites')->assertOk()->json('data'));
        $this->artisan('migrate:rollback', ['--path' => self::DROP])->assertSuccessful();
        $this->assertSame(
            collect($sitesBefore)->pluck('name')->all(),
            DB::table('legacy_sites')->where('organization_id', $this->organization->id)->orderBy('name')->pluck('name')->all(),
        );
        $this->artisan('migrate', ['--path' => self::DROP])->assertSuccessful();
    }

    /** @param  array<string, mixed>  $values */
    private function legacySite(string $name, string $timezone, array $values = []): int
    {
        return DB::table('sites')->insertGetId(['uuid' => (string) Str::uuid(), 'organization_id' => $this->organization->id, 'name' => $name, 'timezone' => $timezone, ...$values, 'created_at' => now()->subYear(), 'updated_at' => now()]);
    }

    private function legacyDevice(string $code, ?int $siteId, string $lifecycle = 'registered'): int
    {
        return DB::table('devices')->insertGetId(['uuid' => (string) Str::uuid(), 'organization_id' => $this->organization->id, 'code' => $code, 'name' => $code, 'site_id' => $siteId, 'lifecycle' => $lifecycle, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function legacyUuid(int $siteId): string
    {
        return (string) DB::table(Schema::hasTable('sites') ? 'sites' : 'legacy_sites')->where('id', $siteId)->value('uuid');
    }

    /** @param  list<string>  $siteUuids  @return list<string> */
    private function resolvedGrant(array $siteUuids): array
    {
        $uuids = Schema::hasTable('sites')
            ? DB::table('devices')->whereIn('site_id', DB::table('sites')->whereIn('uuid', $siteUuids)->select('id'))->pluck('uuid')->all()
            : (new ApplicationGrant($this->organization->id, [], $siteUuids))->resolveUuids();
        sort($uuids);

        return $uuids;
    }
}
