<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Services\IngressConversion;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class DeviceConfigurationService
{
    public function __construct(private readonly RuntimeClient $runtime, private readonly CanonicalJson $canonical) {}

    public function locked(Device $device, int $revision, callable $action): mixed
    {
        return DB::transaction(function () use ($device, $revision, $action) {
            $locked = Device::query()->lockForUpdate()->findOrFail($device->id);
            abort_unless($locked->draft_revision === $revision, 409, 'The device changed. Refresh and review the latest revision.');
            abort_if($locked->lifecycle === 'archived', 422, 'Archived devices are read-only.');

            return $action($locked);
        });
    }

    public function artifact(Device $device, string $uuid): DeviceProfileArtifact
    {
        return DeviceProfileArtifact::query()->where('uuid', $uuid)->whereHas('profile', fn ($q) => $q->where('organization_id', $device->organization_id))->firstOrFail();
    }

    public function saveDraft(Device $device, array $draft, int $revision, int $actor): Device
    {
        return $this->locked($device, $revision, function (Device $locked) use ($draft, $actor) {
            $artifact = $this->artifact($locked, $draft['artifact_uuid']);
            $previous = $locked->configurations()->first();
            if ($previous) {
                abort_unless($previous->artifact->device_profile_id === $artifact->device_profile_id, 422, 'Choose a revision of the device’s existing profile.');
            }
            if ($draft['candidate_uuid'] ?? null) {
                $candidate = DiscoveryCandidate::query()->where('organization_id', $locked->organization_id)->where('uuid', $draft['candidate_uuid'])->lockForUpdate()->firstOrFail();
                abort_if($candidate->status === 'rejected', 422, 'Restore this discovery candidate before using it.');
                abort_if(Device::query()->where('reserved_source_uuid', $candidate->uuid)->whereKeyNot($locked->id)->exists(), 409, 'This source is already assigned to another device.');
                $claimant = $candidate->setupDevice();
                abort_if($claimant && $claimant->id !== $locked->id, 409, 'This source is being set up as another device.');
                if ($locked->applied_configuration_uuid) {
                    abort_unless($locked->reserved_source_uuid === $candidate->uuid, 422, 'Deactivate before selecting a different source.');
                }
                $locked->device_discovery_candidate_id = $candidate->id;
                $locked->reserved_source_uuid = $candidate->uuid;
            }
            $locked->forceFill(['draft' => $draft, 'draft_revision' => $locked->draft_revision + 1, 'updated_by' => $actor])->save();
            DeviceAudit::record('device.configuration.saved', $locked->organization_id, $actor, $locked->uuid, ['draft_revision' => $locked->draft_revision]);

            return $locked->fresh();
        });
    }

    public function compile(Device $device): array
    {
        $draft = $device->draft ?? [];
        abort_unless(! empty($draft['artifact_uuid']), 422, 'Select a published profile revision before validating or activating.');
        $artifact = $this->artifact($device, $draft['artifact_uuid']);
        $candidate = $device->candidate;
        abort_unless($candidate && $candidate->uuid === ($draft['candidate_uuid'] ?? null), 422, 'Select a discovered source.');
        abort_unless($candidate->birth_revision === ($draft['birth_revision'] ?? null), 409, 'The source has a new birth certificate. Review its metrics before activating.');
        $parameters = collect($artifact->definition['parameters'])->keyBy('uuid');
        $metrics = collect($candidate->metrics)->keyBy('name');
        $mappings = [];
        $used = [];
        $errors = [];
        foreach ($draft['mappings'] ?? [] as $i => $mapping) {
            $parameter = $parameters->get($mapping['parameter_uuid']);
            $metric = $metrics->get($mapping['metric']);
            if (! $parameter || ! $metric || ! $parameter['reports_state'] || $parameter['kind'] === 'derived') {
                $errors["mappings.$i"] = 'Map a reported parameter in the selected artifact to a discovered metric.';

                continue;
            }
            if (isset($used[$parameter['uuid']])) {
                $errors["mappings.$i"] = 'Each parameter can have only one input mapping.';
            }
            $used[$parameter['uuid']] = true;
            $conversion = app(IngressConversion::class)->resolve($parameter, $mapping, "mappings.$i");
            $allowed = match ($parameter['data_type']) {
                'boolean' => ['Boolean'], 'integer' => ['Int8', 'Int16', 'Int32', 'Int64', 'UInt8', 'UInt16', 'UInt32', 'UInt64'],
                'number' => ['Float', 'Double', 'Int8', 'Int16', 'Int32', 'Int64', 'UInt8', 'UInt16', 'UInt32', 'UInt64'],
                'enum', 'string' => ['String', 'Text', 'UUID'], 'timestamp' => ['DateTime'], 'bytes' => ['Bytes'], default => [],
            };
            if ($conversion['ingress_conversion'] !== null && $parameter['data_type'] === 'integer') {
                $allowed = [...$allowed, 'Float', 'Double'];
            }
            if (! in_array($metric['datatype'], $allowed, true)) {
                $errors["mappings.$i"] = 'The source datatype is incompatible with this profile parameter.';
            }
            $commandMetric = $mapping['command_metric'] ?? null;
            if ($commandMetric && (! $parameter['accepts_command'] || ! isset($metrics[$commandMetric]) || ! in_array($metrics[$commandMetric]['datatype'], $allowed, true))) {
                $errors["mappings.$i.command_metric"] = 'Commands require a writable profile parameter and a compatible discovered target metric.';
            }
            $mappings[] = $conversion + ['parameter_uuid' => $parameter['uuid'], 'metric' => $metric['name'], 'datatype' => $metric['datatype'],
                'command_metric' => $commandMetric, 'command_datatype' => $commandMetric ? $metrics[$commandMetric]['datatype'] : null];
        }
        foreach ($parameters as $parameter) {
            if ($parameter['reports_state'] && $parameter['kind'] !== 'derived' && ! isset($used[$parameter['uuid']])) {
                $errors['mappings.'.$parameter['uuid']] = 'Map '.$parameter['label'].' before activation.';
            }
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }
        $gateway = $candidate->gateway;
        $installation = DeviceInstallation::where('device_id', $device->id)->whereNull('ended_at')->first();
        $binding = null;
        if ($installation) {
            $physical = AdapterCandidate::findOrFail($installation->device_adapter_candidate_id);
            abort_unless($physical->sparkplug_device_id === $candidate->source_device_id && $physical->adapter->sparkplug_gateway_id === $gateway->id, 422, 'The selected source differs from the active hardware installation.');
            $binding = ['installation_uuid' => $installation->uuid, 'adapter_uuid' => $physical->adapter->uuid, 'manufacturer_serial' => $installation->manufacturer_serial];
        }

        return [
            ...($binding ? ['adapter' => $binding] : []),
            'schema_version' => 'device-configuration.v2', 'device_uuid' => $device->uuid,
            'organization_uuid' => $device->organization->uuid, 'profile_artifact_uuid' => $artifact->uuid,
            'profile_hash' => $artifact->definition_hash, 'profile_canonical_json' => $this->canonical->encode($artifact->definition),
            'source' => ['connection_uuid' => $gateway->connection->uuid, 'candidate_uuid' => $candidate->uuid,
                'group_id' => $gateway->connection->group_id, 'edge_node_id' => $gateway->edge_node_id, 'device_id' => $candidate->source_device_id],
            'birth_revision' => $candidate->birth_revision, 'mappings' => $mappings,
        ];
    }

    public function validate(Device $device, int $revision): array
    {
        return $this->locked($device, $revision, function (Device $locked) {
            $definition = $this->compile($locked);
            $preview = $this->runtime->request('POST', '/internal/validate', ['definition' => $definition, 'metrics' => $locked->candidate->metrics]);

            return ['draft_revision' => $locked->draft_revision, 'definition' => $definition, 'preview' => $preview];
        });
    }

    public function activate(Device $device, int $revision, int $actor, ?string $rollback = null): Device
    {
        return $this->locked($device, $revision, function (Device $locked) use ($actor, $rollback) {
            abort_if($locked->deployment_status === 'pending', 409, 'Wait for the pending deployment to finish.');
            abort_if($locked->commands()->whereNotNull('outstanding_key')->exists(), 409, 'Finish outstanding commands before changing configuration.');
            if ($rollback) {
                $old = $locked->configurations()->where('uuid', $rollback)->firstOrFail();
                $definition = $old->definition;
                abort_unless($locked->candidate && $definition['source']['candidate_uuid'] === $locked->candidate->uuid, 422, 'The rollback uses a different source.');
                $definition['birth_revision'] = $locked->candidate->birth_revision;
            } else {
                $definition = $this->compile($locked);
            }
            $this->runtime->request('POST', '/internal/validate', ['definition' => $definition, 'metrics' => $locked->candidate->metrics]);
            $artifact = $this->artifact($locked, $definition['profile_artifact_uuid']);
            $uuid = (string) Str::uuid();
            $definition['configuration_uuid'] = $uuid;
            $configuration = $locked->configurations()->create([
                'uuid' => $uuid, 'device_profile_artifact_id' => $artifact->id,
                'revision' => ($locked->configurations()->max('revision') ?? 0) + 1,
                'definition_hash' => hash('sha256', $this->canonical->encode($definition)), 'definition' => $definition,
                'created_by' => $actor, 'created_at' => now(),
            ]);
            $locked->forceFill(['desired_configuration_uuid' => $uuid, 'deployment_status' => 'pending',
                'state_revision' => $locked->state_revision + 1, 'deployment_generation' => $locked->deployment_generation + 1, 'draft_revision' => $locked->draft_revision + 1,
                'diagnostic' => null, 'updated_by' => $actor])->save();
            $operation = DeviceLifecycleService::record($locked, $rollback ? 'rollback' : 'configure', $actor);
            $locked->candidate->update(['status' => 'approved']);
            DeviceAudit::enqueue('device.activate.v1', ['organization_uuid' => $locked->organization->uuid,
                'device_uuid' => $locked->uuid, 'generation' => $locked->deployment_generation, 'operation_uuid' => $operation->uuid, 'definition' => $configuration->definition]);
            DeviceAudit::record($rollback ? 'device.rollback.requested' : 'device.activation.requested', $locked->organization_id, $actor, $locked->uuid, ['configuration_uuid' => $uuid]);

            return $locked->fresh();
        });
    }

    public function deactivate(Device $device, int $revision, int $actor): Device
    {
        return $this->locked($device, $revision, function (Device $locked) use ($actor) {
            abort_if($locked->deployment_status === 'pending', 409, 'Wait for the pending deployment to finish.');
            $locked->forceFill(['desired_configuration_uuid' => null, 'deployment_status' => 'pending',
                'state_revision' => $locked->state_revision + 1, 'deployment_generation' => $locked->deployment_generation + 1, 'draft_revision' => $locked->draft_revision + 1])->save();
            $operation = DeviceLifecycleService::record($locked, 'deactivate', $actor);
            DeviceAudit::enqueue('device.deactivate.v1', ['organization_uuid' => $locked->organization->uuid,
                'device_uuid' => $locked->uuid, 'generation' => $locked->deployment_generation, 'operation_uuid' => $operation->uuid]);
            DeviceAudit::record('device.deactivation.requested', $locked->organization_id, $actor, $locked->uuid);

            return $locked->fresh();
        });
    }
}
