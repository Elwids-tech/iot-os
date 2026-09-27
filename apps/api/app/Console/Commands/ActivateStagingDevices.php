<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Services\DeviceConfigurationService;
use App\Domain\Devices\Services\DeviceLifecycleService;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceActivationBatch;
use App\Domain\Geospatial\Services\GeofenceService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\GpsUseCaseSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

final class ActivateStagingDevices extends Command
{
    protected $signature = 'deployment:activate-staging';

    protected $description = 'Activate untouched staging fixtures and wait for runtime acknowledgements';

    public function handle(): int
    {
        if (! app()->environment('staging') || ! config('deployment.demo_enabled')) {
            $this->error('Requires explicitly enabled staging.');

            return self::FAILURE;
        }
        $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $service = app(DeviceConfigurationService::class);
        foreach (['meter' => 'three-phase-energy-meter', 'rgb-light' => 'rgb-light'] as $source => $profileCode) {
            $device = Device::where('organization_id', $org->id)->where('code', 'staging-'.$source)->first();
            if (! $device) {
                $candidate = DiscoveryCandidate::where('organization_id', $org->id)->where('source_device_id', $source)
                    ->whereHas('gateway', fn ($q) => $q->where('edge_node_id', 'simulator-edge'))->firstOrFail();
                abort_unless($candidate->presence === 'online', 409, 'Wait for simulator birth before activation.');
                $artifact = DeviceProfile::where('organization_id', $org->id)->where('code', 'simulator-'.$profileCode)->firstOrFail()->activeArtifact()->firstOrFail();
                $normalize = static fn ($value) => preg_replace('/[\s._-]/', '', strtolower($value));
                $mappings = [];
                foreach ($artifact->definition['parameters'] as $parameter) {
                    if (! $parameter['reports_state'] || $parameter['kind'] === 'derived') {
                        continue;
                    }
                    $metric = collect($candidate->metrics)->first(fn ($m) => in_array($normalize($m['name']), [$normalize($parameter['label']), $normalize($parameter['key'])], true));
                    abort_unless($metric, 422, 'Simulator mapping is incomplete.');
                    $mappings[] = ['parameter_uuid' => $parameter['uuid'], 'metric' => $metric['name'], 'command_metric' => $parameter['accepts_command'] ? $metric['name'] : null];
                }
                $device = Device::create(['organization_id' => $org->id, 'code' => 'staging-'.$source, 'name' => 'Staging '.$source, 'created_by' => $actor->id, 'updated_by' => $actor->id])->refresh();
                $device = $service->saveDraft($device, ['artifact_uuid' => $artifact->uuid, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => $candidate->birth_revision, 'mappings' => $mappings], $device->draft_revision, $actor->id);
            }
            if ($device->deployment_generation === 0 && $device->draft_revision === 2) {
                $service->activate($device, $device->draft_revision, $actor->id);
            }
            $this->waitFor($device);
        }
        foreach (GpsUseCaseSeeder::deviceUuids() as $uuid) {
            $device = Device::where('organization_id', $org->id)->where('uuid', $uuid)->firstOrFail();
            if ($device->deployment_generation === 0 && $device->draft_revision === 1) {
                app(DeviceLifecycleService::class)->request($device, ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'expected_generation' => 0], $actor->id);
            }
            $this->waitFor($device);
        }
        $fence = Geofence::where('organization_id', $org->id)->where('uuid', GpsUseCaseSeeder::WORKFLOW_UUID)->firstOrFail();
        $geo = app(GeofenceService::class);
        // Never publish tester edits on a repeat bootstrap.
        if ($fence->revision === 1 && ! GeofenceActivationBatch::where('geofence_id', $fence->id)->exists()) {
            $view = $geo->view($fence);
            $result = $geo->saveAndActivate($org, $fence, ['operation_uuid' => (string) Str::uuid(), 'expected_revision' => 1,
                'name' => $fence->name, 'geometry' => $fence->geometry,
                'assignments' => $view['assignments']->map(fn ($a) => ['device_uuid' => $a['device']['uuid'], 'policy' => $a['policy']])->all()], $actor->id);
            $batch = GeofenceActivationBatch::where('uuid', $result['activation']['uuid'])->firstOrFail();
            $deadline = time() + 90;
            do {
                $status = $geo->batch($batch->fresh())['status'];
                if ($status === 'succeeded') {
                    break;
                }
                abort_if($status !== 'pending', 409, 'Geofence activation failed; inspect the operation.');
                sleep(1);
            } while (time() < $deadline);
            abort_unless($status === 'succeeded', 409, 'Geofence acknowledgement timed out.');
        }
        $this->info('Simulator devices confirmed active. Existing tester changes preserved.');

        return self::SUCCESS;
    }

    private function waitFor(Device $device): void
    {
        $deadline = time() + 90;
        do {
            $device->refresh();
            if ($device->applied_configuration_uuid && $device->deployment_status === 'applied' && $device->lifecycle === 'active') {
                return;
            }
            if ($device->deployment_status !== 'pending') {
                break;
            }
            sleep(1);
        } while (time() < $deadline);
        abort(409, 'Device is not confirmed active; inspect its operation before retrying.');
    }
}
