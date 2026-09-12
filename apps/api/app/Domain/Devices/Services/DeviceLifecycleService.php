<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceOperation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class DeviceLifecycleService
{
    public function request(Device $device, array $input, int $actor): Device
    {
        return DB::transaction(function () use ($device, $input, $actor) {
            $locked = Device::whereKey($device->id)->lockForUpdate()->firstOrFail();
            $existing = DeviceOperation::where('uuid', $input['operation_uuid'])->first();
            if ($existing) {
                abort_unless($existing->device_id === $locked->id && $existing->actor_id === $actor &&
                    $existing->target_state === $input['target_state'] && $existing->expected_generation === $input['expected_generation'], 409, 'Operation UUID was already used for a different request.');

                return $locked;
            }
            abort_if($locked->lifecycle === 'archived', 422, 'Archived devices are read-only.');
            abort_unless($locked->deployment_generation === $input['expected_generation'], 409, 'The device changed. Review its current state.');
            abort_if($locked->deployment_status === 'pending', 409, 'Wait for the current transition to be confirmed.');
            $active = $input['target_state'] === 'active';
            abort_unless($active ? $locked->lifecycle === 'deactivated' : (bool) $locked->applied_configuration_uuid, 409, 'The device is not in the expected lifecycle state.');
            $configuration = null;
            if ($active) {
                $configuration = $locked->configurations()->where('uuid', $locked->last_applied_configuration_uuid)->first();
                abort_unless($configuration, 422, 'No confirmed working configuration is available. Review Configuration before activation.');
                abort_unless($locked->candidate && $configuration->definition['source']['candidate_uuid'] === $locked->candidate->uuid, 422, 'The working configuration uses a different source. Review Configuration.');
            }
            $locked->forceFill([
                'desired_configuration_uuid' => $configuration?->uuid, 'deployment_status' => 'pending',
                'deployment_generation' => $locked->deployment_generation + 1,
                'state_revision' => $locked->state_revision + 1,
                'diagnostic' => null, 'updated_by' => $actor,
            ])->save();
            $operation = self::record($locked, $active ? 'resume' : 'deactivate', $actor, $input['operation_uuid']);
            $payload = ['device_uuid' => $locked->uuid, 'organization_uuid' => $locked->organization->uuid,
                'generation' => $locked->deployment_generation, 'operation_uuid' => $operation->uuid];
            if ($configuration) {
                $payload['definition'] = $configuration->definition;
            }
            DeviceAudit::enqueue($active ? 'device.activate.v1' : 'device.deactivate.v1', $payload);
            DeviceAudit::record('device.'.$operation->kind.'.requested', $locked->organization_id, $actor, $locked->uuid,
                ['operation_uuid' => $operation->uuid, 'configuration_uuid' => $configuration?->uuid, 'generation' => $locked->deployment_generation]);

            return $locked->fresh();
        });
    }

    public static function record(Device $device, string $kind, int $actor, ?string $uuid = null): DeviceOperation
    {
        return DeviceOperation::create([
            'uuid' => $uuid ?? (string) Str::uuid(), 'device_id' => $device->id, 'actor_id' => $actor,
            'target_state' => $device->desired_configuration_uuid ? 'active' : 'inactive', 'kind' => $kind,
            'expected_generation' => $device->deployment_generation - 1, 'generation' => $device->deployment_generation,
            'configuration_uuid' => $device->desired_configuration_uuid, 'status' => 'pending',
            'outstanding_key' => $device->uuid, 'created_at' => now(),
        ]);
    }
}
