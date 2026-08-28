<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceManagement;

use App\Domain\DeviceProfile\Enums\DefinitionState;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

final class DeviceDomainSchemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_device_domain_tables_expose_the_versioning_and_tenant_columns(): void
    {
        $this->assertTrue(Schema::hasColumns('device_profile_versions', [
            'organization_id',
            'device_profile_id',
            'state',
            'definition',
            'revision',
            'artifact',
            'artifact_hash',
            'source_hash',
        ]));
        $this->assertTrue(Schema::hasColumns('transport_binding_versions', [
            'organization_id',
            'transport_binding_id',
            'device_profile_version_id',
            'state',
            'definition',
            'revision',
        ]));
        $this->assertTrue(Schema::hasColumns('definition_test_runs', [
            'profile_revision',
            'binding_revision',
            'input_hash',
            'valid',
            'profile_artifact_hash',
            'binding_artifact_hash',
        ]));
        $this->assertTrue(Schema::hasColumns('devices', [
            'organization_id',
            'external_id',
            'lifecycle_state',
            'revision',
            'registered_at',
            'archived_at',
        ]));
    }

    public function test_composite_foreign_keys_reject_cross_tenant_profile_versions(): void
    {
        $profileOrganization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $profile = DeviceProfile::query()->create([
            'organization_id' => $profileOrganization->id,
            'key' => 'environment_sensor',
            'name' => 'Environment Sensor',
        ]);

        $this->expectException(QueryException::class);
        DeviceProfileVersion::query()->create([
            'organization_id' => $otherOrganization->id,
            'device_profile_id' => $profile->id,
            'version' => 1,
            'state' => DefinitionState::DRAFT,
            'definition' => ['version' => 1, 'components' => []],
        ]);
    }
}
