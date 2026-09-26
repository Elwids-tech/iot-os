<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;

/** Opt-in local fixture for exercising generic GPS, geofence, alert, and dashboard features. */
final class GpsUseCaseSeeder extends Seeder
{
    public const PROFILE_CODE = 'simulator-gps-tracker';

    public const DEVICE_CODE = 'gps-demo-tracker';

    public const DEVICE_UUID = '30000000-0000-4000-8000-000000000100';

    public const CONFIGURATION_UUID = '30000000-0000-4000-8000-000000000101';

    public const WORKFLOW_UUID = '30000000-0000-4000-8000-000000000200';

    public const DASHBOARD_UUID = '30000000-0000-4000-8000-000000000300';

    public function run(string $organizationSlug = 'acme-manufacturing'): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new LogicException('The GPS use-case seeder is restricted to local and testing environments.');
        }

        $organization = Organization::where('slug', $organizationSlug)->firstOrFail();
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $profile = $this->profile($organization, $actor);
        $artifact = $profile->activeArtifact()->firstOrFail();

        DB::transaction(function () use ($organization, $actor, $profile, $artifact): void {
            $connection = SparkplugConnection::firstOrCreate(
                ['group_id' => 'simulator-'.$organization->uuid],
                ['organization_id' => $organization->id, 'name' => 'Local simulator', 'host_id' => 'iot-host-'.$organization->uuid,
                    'username' => 'sim-host-'.$organization->uuid, 'password' => Str::random(48)],
            );
            $gateway = SparkplugGateway::firstOrCreate(
                ['sparkplug_connection_id' => $connection->id, 'edge_node_id' => 'simulator-gps-edge'],
                ['organization_id' => $organization->id, 'name' => 'GPS simulator gateway',
                    'username' => 'sim-gps-edge-'.$organization->uuid, 'password' => Str::random(48)],
            );
            $candidate = DiscoveryCandidate::firstOrCreate(
                ['sparkplug_gateway_id' => $gateway->id, 'source_device_id' => 'gps-tracker'],
                ['uuid' => '30000000-0000-4000-8000-000000000102', 'organization_id' => $organization->id,
                    'status' => 'approved', 'presence' => 'unseen', 'birth_revision' => 1, 'metrics' => $this->metrics()],
            );
            $device = Device::firstOrCreate(
                ['organization_id' => $organization->id, 'code' => self::DEVICE_CODE],
                ['uuid' => self::DEVICE_UUID, 'name' => 'GPS Demo Tracker', 'serial_number' => 'SIM-GPS-001',
                    'description' => 'Local simulator device following a route across the demo geofence.',
                    'lifecycle' => 'deactivated', 'presence' => 'offline', 'deployment_status' => 'inactive',
                    'deployment_generation' => 0, 'device_discovery_candidate_id' => $candidate->id,
                    'reserved_source_uuid' => $candidate->uuid, 'created_by' => $actor->id, 'updated_by' => $actor->id],
            );

            $parameters = $profile->parameters()->get()->keyBy('key');
            $canonical = app(CanonicalJson::class)->encode($artifact->definition);
            $definition = [
                'schema_version' => 'device-configuration.v2', 'configuration_uuid' => self::CONFIGURATION_UUID,
                'device_uuid' => $device->uuid, 'organization_uuid' => $organization->uuid,
                'profile_artifact_uuid' => $artifact->uuid, 'profile_hash' => $artifact->definition_hash,
                'profile_canonical_json' => $canonical,
                'source' => ['connection_uuid' => $connection->uuid, 'candidate_uuid' => $candidate->uuid,
                    'group_id' => $connection->group_id, 'edge_node_id' => $gateway->edge_node_id, 'device_id' => 'gps-tracker'],
                'birth_revision' => 1,
                'mappings' => collect(['location.latitude' => 'Latitude', 'location.longitude' => 'Longitude', 'location.accuracy' => 'Accuracy'])
                    ->map(fn (string $metric, string $key): array => ['parameter_uuid' => $parameters[$key]->uuid, 'metric' => $metric,
                        'datatype' => 'Double', 'command_metric' => null, 'command_datatype' => null])->values()->all(),
            ];
            $configuration = DeviceConfiguration::firstOrCreate(
                ['uuid' => self::CONFIGURATION_UUID],
                ['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1,
                    'definition_hash' => hash('sha256', app(CanonicalJson::class)->encode($definition)), 'definition' => $definition,
                    'created_by' => $actor->id, 'created_at' => now()],
            );
            if ($device->wasRecentlyCreated) {
                $device->forceFill(['last_applied_configuration_uuid' => $configuration->uuid])->save();
            }

            $workflow = $this->workflow($organization, $actor, $device, $configuration, $parameters->all());
            $this->dashboard($organization, $actor, $device, $workflow, $parameters->all());
        });
    }

    private function profile(Organization $organization, User $actor): DeviceProfile
    {
        $existing = DeviceProfile::where('organization_id', $organization->id)->where('code', self::PROFILE_CODE)->first();
        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($organization, $actor): DeviceProfile {
            $definition = json_decode(file_get_contents(base_path('../../contracts/definitions/device-profiles/gps-tracker.v1.json')), true, 512, JSON_THROW_ON_ERROR);
            $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => self::PROFILE_CODE,
                'name' => 'GPS Tracker (simulator)', 'category' => $definition['profile']['category'],
                'created_by' => $actor->id, 'updated_by' => $actor->id]);
            foreach ($definition['parameters'] as $index => $parameter) {
                $profile->parameters()->create(['key' => $parameter['key'], 'label' => $parameter['label'], 'kind' => $parameter['kind'],
                    'data_type' => $parameter['data_type'], 'format' => $parameter['format'], 'unit' => $parameter['unit'],
                    'reports_state' => $parameter['reports_state'], 'accepts_command' => $parameter['accepts_command'],
                    'validation_logic' => $parameter['validation'], 'display_config' => $parameter['display'],
                    'reporting_config' => $parameter['reporting'], 'counter_config' => $parameter['counter'], 'sort_order' => $index]);
            }
            app(PublishDeviceProfile::class)->handle($profile->fresh(), $actor, 1);

            return $profile->fresh();
        });
    }

    private function workflow(Organization $organization, User $actor, Device $device, DeviceConfiguration $configuration, array $parameters): Workflow
    {
        $binding = ['schema_version' => 'location-binding.v1', 'uuid' => '30000000-0000-4000-8000-000000000201', 'revision' => 1,
            'organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $configuration->uuid,
            'generation' => 1, 'latitude_parameter_uuid' => $parameters['location.latitude']->uuid,
            'longitude_parameter_uuid' => $parameters['location.longitude']->uuid, 'accuracy_parameter_uuid' => $parameters['location.accuracy']->uuid,
            'pairing' => 'same_event', 'max_age_seconds' => 90, 'max_future_skew_seconds' => 5, 'allow_unknown_accuracy' => true];
        $geometry = ['type' => 'Polygon', 'coordinates' => [[[-114.01, 50.99], [-113.99, 50.99], [-113.99, 51.01], [-114.01, 51.01], [-114.01, 50.99]]]];
        $graph = ['schema_version' => 'automation-workflow.v1', 'uuid' => self::WORKFLOW_UUID,
            'version_uuid' => '30000000-0000-4000-8000-000000000202',
            'nodes' => [
                ['id' => '0', 'type' => 'location.source.v1', 'config' => ['binding' => $binding]],
                ['id' => '1', 'type' => 'geofence.membership.v1', 'config' => ['geometry' => $geometry, 'uncertainty_metres' => 2]],
                ['id' => '2', 'type' => 'condition.sustained.v1', 'config' => ['outside_for_seconds' => 60, 'max_gap_seconds' => 45, 'minimum_samples' => 2]],
                ['id' => '3', 'type' => 'alert.condition.v1', 'config' => (object) []],
            ],
            'edges' => [['source' => '0', 'target' => '1'], ['source' => '1', 'target' => '2'], ['source' => '2', 'target' => '3']]];
        $definition = ['schema_version' => 'geofence-rule.v1', 'uuid' => self::WORKFLOW_UUID,
            'version_uuid' => $graph['version_uuid'], 'evaluator_version' => 'geofence.v1',
            'pipeline' => ['location.source.v1', 'geofence.membership.v1', 'condition.sustained.v1', 'alert.condition.v1'],
            'binding' => $binding, 'geometry' => $geometry,
            'policy' => ['outside_for_seconds' => 60, 'max_gap_seconds' => 45, 'minimum_samples' => 2, 'uncertainty_metres' => 2]];
        $workflow = Workflow::firstOrCreate(['uuid' => self::WORKFLOW_UUID], ['organization_id' => $organization->id,
            'name' => 'GPS demo geofence', 'workflow' => $graph, 'definition' => $definition,
            'definition_hash' => hash('sha256', app(CanonicalJson::class)->encode($definition)), 'updated_by' => $actor->id]);
        if ($workflow->wasRecentlyCreated) {
            DB::table('automation_workflow_revisions')->insert(['automation_workflow_id' => $workflow->id, 'revision' => 1,
                'snapshot' => json_encode(['uuid' => $workflow->uuid, 'name' => $workflow->name, 'workflow' => $graph], JSON_THROW_ON_ERROR),
                'created_by' => $actor->id, 'created_at' => now()]);
        }

        return $workflow;
    }

    private function dashboard(Organization $organization, User $actor, Device $device, Workflow $workflow, array $parameters): void
    {
        $source = fn (string $key, string $label, int $precision, string $color): array => [
            'device_uuid' => $device->uuid, 'parameter_uuid' => $parameters[$key]->uuid, 'device_name' => $device->name,
            'label' => $label, 'unit' => $parameters[$key]->unit, 'data_type' => 'number', 'format' => null,
            'display_widget' => 'number', 'precision' => $precision, 'color' => $color,
            'base' => ['label' => 'Current', 'color' => '#64748b'], 'thresholds' => [],
        ];
        $widgets = [
            ['id' => 'position', 'schema_version' => 2, 'type' => 'status', 'title' => 'Current position',
                'description' => 'Latest coordinates reported by the simulated tracker.', 'config' => ['sources' => [
                    $source('location.latitude', 'Latitude', 6, '#2563eb'), $source('location.longitude', 'Longitude', 6, '#16a34a')]]],
            ['id' => 'accuracy', 'schema_version' => 2, 'type' => 'status', 'title' => 'GPS accuracy',
                'description' => 'Reported horizontal accuracy in metres.', 'config' => ['sources' => [$source('location.accuracy', 'Accuracy', 1, '#d97706')]]],
            ['id' => 'trail', 'schema_version' => 2, 'type' => 'timeseries', 'title' => 'Coordinate history',
                'description' => 'Latitude and longitude over the selected time range.', 'config' => ['sources' => [
                    $source('location.latitude', 'Latitude', 6, '#2563eb'), $source('location.longitude', 'Longitude', 6, '#16a34a')]]],
            ['id' => 'location', 'schema_version' => 2, 'type' => 'location', 'title' => 'Geofence location',
                'description' => 'Latest accepted fix and fence state.', 'config' => ['sources' => [], 'workflow_uuid' => $workflow->uuid]],
            ['id' => 'alerts', 'schema_version' => 2, 'type' => 'alerts', 'title' => 'Geofence alerts',
                'description' => 'Active and recent boundary alerts.', 'config' => ['sources' => [], 'workflow_uuid' => $workflow->uuid]],
        ];
        $layout = [
            ['i' => 'position', 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 4], ['i' => 'accuracy', 'x' => 6, 'y' => 0, 'w' => 6, 'h' => 4],
            ['i' => 'trail', 'x' => 0, 'y' => 4, 'w' => 12, 'h' => 6], ['i' => 'location', 'x' => 0, 'y' => 10, 'w' => 6, 'h' => 7],
            ['i' => 'alerts', 'x' => 6, 'y' => 10, 'w' => 6, 'h' => 7],
        ];
        Dashboard::firstOrCreate(['uuid' => self::DASHBOARD_UUID], ['organization_id' => $organization->id,
            'name' => 'GPS and geofence demo', 'widgets' => $widgets, 'layouts' => ['lg' => $layout],
            'defaults' => DashboardDefinition::defaults(), 'created_by' => $actor->id, 'updated_by' => $actor->id]);
    }

    private function metrics(): array
    {
        return [
            ['name' => 'Latitude', 'alias' => 1, 'datatype' => 'Double'],
            ['name' => 'Longitude', 'alias' => 2, 'datatype' => 'Double'],
            ['name' => 'Accuracy', 'alias' => 3, 'datatype' => 'Double'],
        ];
    }
}
