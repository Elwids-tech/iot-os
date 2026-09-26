<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\GpsUseCaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class GpsUseCaseSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_creates_an_idempotent_simulator_backed_gps_demo(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(GpsUseCaseSeeder::class);

        $profile = DeviceProfile::where('code', GpsUseCaseSeeder::PROFILE_CODE)->firstOrFail();
        $this->assertSame(['location.accuracy', 'location.latitude', 'location.longitude'], $profile->parameters()->orderBy('key')->pluck('key')->all());
        $this->assertNotNull($profile->activeArtifact);

        $device = Device::where('code', GpsUseCaseSeeder::DEVICE_CODE)->firstOrFail();
        $this->assertSame('deactivated', $device->lifecycle);
        $this->assertSame('inactive', $device->deployment_status);
        $this->assertNull($device->applied_configuration_uuid);
        $this->assertNull($device->desired_configuration_uuid);
        $this->assertNotNull($device->last_applied_configuration_uuid);
        $this->assertSame('gps-tracker', $device->candidate->source_device_id);
        $this->assertSame(['Accuracy', 'Latitude', 'Longitude'], collect($device->candidate->metrics)->pluck('name')->sort()->values()->all());

        $workflow = Workflow::where('uuid', GpsUseCaseSeeder::WORKFLOW_UUID)->firstOrFail();
        $this->assertSame($device->uuid, $workflow->definition['binding']['device_uuid']);
        $this->assertSame('inactive', $workflow->deployment_status);

        $dashboard = Dashboard::where('uuid', GpsUseCaseSeeder::DASHBOARD_UUID)->firstOrFail();
        $this->assertSame(['status', 'status', 'timeseries', 'location', 'alerts'], collect($dashboard->widgets)->pluck('type')->all());
        $this->assertSame($workflow->uuid, $dashboard->widgets[3]['config']['workflow_uuid']);

        $dashboard->update(['name' => 'My GPS operations view']);
        $this->seed(GpsUseCaseSeeder::class);

        $this->assertSame('My GPS operations view', $dashboard->fresh()->name);
        $this->assertSame(1, Device::where('code', GpsUseCaseSeeder::DEVICE_CODE)->count());
        $this->assertSame(1, DiscoveryCandidate::where('source_device_id', 'gps-tracker')->count());
        $this->assertSame(1, Workflow::where('uuid', GpsUseCaseSeeder::WORKFLOW_UUID)->count());
        $this->assertSame(1, Dashboard::where('uuid', GpsUseCaseSeeder::DASHBOARD_UUID)->count());
    }
}
