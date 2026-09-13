<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Models\DeviceConfiguration;
use Illuminate\Support\Facades\DB;

final class DeviceCommandService
{
    public function __construct(private readonly RuntimeClient $runtime, private readonly ParameterValue $values) {}
    /** An intentional control interaction prepares and confirms one audited request. */
    public function send(Device $device, array $values, int $actor): DeviceCommand
    {
        return DB::transaction(function () use ($device, $values, $actor) {
            $command = $this->prepare($device, $values, $actor);

            return $this->confirm($device, $command, $actor);
        });
    }

    public function expire(Device $device): void
    {
        // Execution stops at 30 seconds in the runtime. Allow its durable outcome to arrive
        // before declaring delivery uncertain during a control-plane interruption.
        foreach ($device->commands()->whereNotNull('outstanding_key')->where(function ($query): void {
            $query->where(fn ($query) => $query->where('status', 'prepared')->where('expires_at', '<=', now()))
                ->orWhere(fn ($query) => $query->where('status', '!=', 'prepared')->where('expires_at', '<=', now()->subSeconds(10)));
        })->get() as $command) {
            $command->update(['status' => $command->status === 'prepared' ? 'cancelled' : 'uncertain', 'outstanding_key' => null,
                'completed_at' => now(), 'diagnostic' => $command->status === 'prepared' ? 'The unconfirmed request expired.' : 'No terminal runtime outcome was received before the deadline. Do not assume the command failed to reach the device.']);
        }
    }

    private function configuration(Device $device, string $uuid, string $parameterUuid, mixed $value): DeviceConfiguration
    {
        abort_unless($device->lifecycle === 'active' && in_array($device->deployment_status, ['applied', 'failed'], true) && $device->applied_configuration_uuid === $uuid, 409, 'The applied device configuration changed or is unavailable.');
        $configuration = $device->configurations()->where('uuid', $uuid)->firstOrFail();
        $profile = json_decode($configuration->definition['profile_canonical_json'], true, 512, JSON_THROW_ON_ERROR);
        $parameter = collect($profile['parameters'])->firstWhere('uuid', $parameterUuid);
        $mapping = collect($configuration->definition['mappings'])->firstWhere('parameter_uuid', $parameterUuid);
        abort_unless($parameter && $parameter['accepts_command'] && $parameter['reports_state'] && ($mapping['command_metric'] ?? null), 422, 'This parameter has no approved state-setting command mapping.');
        $this->values->validate($parameter, $value);

        return $configuration;
    }

    public function prepare(Device $device, array $values, int $actor): DeviceCommand
    {
        return DB::transaction(function () use ($device, $values, $actor) {
            $locked = Device::whereKey($device->id)->lockForUpdate()->firstOrFail();
            $this->expire($locked);
            $configuration = $this->configuration($locked, $values['configuration_uuid'], $values['parameter_uuid'], $values['value']);
            $existing = $locked->commands()->where('idempotency_key', $values['idempotency_key'])->first();
            if ($existing) {
                abort_unless($existing->created_by === $actor && $existing->device_configuration_id === $configuration->id && $existing->parameter_uuid === $values['parameter_uuid'] && $existing->value === $values['value'], 409, 'This idempotency key belongs to a different request.');

                return $existing;
            }
            abort_if($locked->commands()->where('parameter_uuid', $values['parameter_uuid'])->whereNotNull('outstanding_key')->exists(), 409, 'A command for this parameter is already outstanding.');
            $this->runtime->request('POST', '/internal/command-check', ['organization_uuid' => $locked->organization->uuid, 'device_uuid' => $locked->uuid, ...$values]);
            $command = $locked->commands()->create(['device_configuration_id' => $configuration->id, 'parameter_uuid' => $values['parameter_uuid'],
                'idempotency_key' => $values['idempotency_key'], 'value' => $values['value'], 'created_by' => $actor,
                'outstanding_key' => $locked->uuid.':'.$values['parameter_uuid'], 'expires_at' => now()->addMinutes(5)]);
            DeviceAudit::record('command.prepared', $locked->organization_id, $actor, $command->uuid, ['device_uuid' => $locked->uuid, 'parameter_uuid' => $command->parameter_uuid, 'value' => $command->value]);

            return $command->refresh();
        });
    }

    public function confirm(Device $device, DeviceCommand $command, int $actor): DeviceCommand
    {
        return DB::transaction(function () use ($device, $command, $actor) {
            $locked = Device::whereKey($device->id)->lockForUpdate()->firstOrFail();
            $this->expire($locked);
            $command = $locked->commands()->whereKey($command->id)->lockForUpdate()->firstOrFail();
            abort_unless($command->created_by === $actor, 403, 'Only the user who prepared this command may confirm it.');
            if ($command->confirmed_at) {
                return $command;
            }
            abort_unless($command->status === 'prepared' && $command->expires_at->isFuture(), 409, 'Prepare a new command; this request is no longer confirmable.');
            $configuration = $this->configuration($locked, $command->configuration->uuid, $command->parameter_uuid, $command->value);
            $check = $this->runtime->request('POST', '/internal/command-check', ['organization_uuid' => $locked->organization->uuid, 'device_uuid' => $locked->uuid, 'configuration_uuid' => $configuration->uuid, 'parameter_uuid' => $command->parameter_uuid, 'value' => $command->value]);
            $already = $check['already_at_target'] ?? false;
            $command->update(['status' => $already ? 'already_at_target' : 'pending', 'confirmed_at' => now(), 'expires_at' => now()->addSeconds(30),
                'completed_at' => $already ? now() : null, 'outstanding_key' => $already ? null : $command->outstanding_key]);
            if (! $already) {
                DeviceAudit::enqueue('device.command.v1', ['command_uuid' => $command->uuid, 'generation' => $locked->deployment_generation, 'organization_uuid' => $locked->organization->uuid,
                    'device_uuid' => $locked->uuid, 'configuration_uuid' => $configuration->uuid, 'parameter_uuid' => $command->parameter_uuid,
                    'value' => $command->value, 'confirmed_at' => $command->confirmed_at->toIso8601String(), 'expires_at' => $command->expires_at->toIso8601String(),
                    'session_id' => $check['session_id'] ?? null]);
            }
            DeviceAudit::record('command.confirmed', $locked->organization_id, $actor, $command->uuid, ['status' => $command->status]);

            return $command->fresh();
        });
    }
}
