<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DeviceOperation;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\User;

final class DeviceView
{
    public static function operation(DeviceOperation $operation): array
    {
        return $operation->only(['uuid', 'target_state', 'kind', 'generation', 'configuration_uuid', 'status', 'diagnostic', 'created_at', 'completed_at']);
    }

    public static function presence(Device $device): string
    {
        return $device->presence === 'online' && (! $device->runtime_seen_at || $device->runtime_seen_at->lt(now()->subSeconds(20))) ? 'unknown' : $device->presence;
    }

    public static function device(Device $device, bool $detail = false): array
    {
        $presence = self::presence($device);
        $data = $device->only(['uuid', 'code', 'name', 'serial_number', 'description', 'lifecycle', 'deployment_status', 'draft_revision', 'deployment_generation', 'desired_configuration_uuid', 'applied_configuration_uuid', 'diagnostic', 'last_seen_at']);
        $data['presence'] = $presence;
        $data['state_revision'] = (int) $device->state_revision;
        $data['last_applied_configuration_uuid'] = $device->last_applied_configuration_uuid;
        $data['operation'] = $device->latestOperation ? self::operation($device->latestOperation) : null;

        $data['candidate'] = $device->candidate ? self::candidate($device->candidate) : null;
        // Same rule as telemetry reads: the applied configuration, else the last one the runtime confirmed.
        $artifact = ($device->appliedConfiguration ?? $device->lastAppliedConfiguration)?->artifact;
        $data['profile'] = $artifact?->profile ? ['uuid' => $artifact->profile->uuid, 'name' => $artifact->profile->name, 'revision' => $artifact->revision] : null;
        if ($detail) {
            $data['installations'] = \App\Domain\DeviceAdapters\Models\DeviceInstallation::where('device_id', $device->id)->latest('started_at')->limit(20)->get()->map(fn ($installation) => $installation->only(['uuid', 'manufacturer_serial', 'adapter_revision_uuid', 'started_at', 'ended_at']));
            $data['retention'] = app(RetentionService::class)->effective($device->organization);
            $data['draft'] = $device->draft;
            $artifact = isset($device->draft['artifact_uuid']) ? DeviceProfileArtifact::where('uuid', $device->draft['artifact_uuid'])->first() : null;
            $data['draft_artifact'] = $artifact ? [...$artifact->only(['uuid', 'revision', 'definition_hash', 'definition', 'status', 'compiled_at']), 'profile_uuid' => $artifact->profile->uuid] : null;
            $data['configurations'] = $device->configurations()->with('artifact.profile')->orderByDesc('revision')->get()->map(fn ($c) => self::configuration($c));
        }

        return $data;
    }

    public static function configuration(DeviceConfiguration $configuration): array
    {
        $artifact = $configuration->artifact;

        return [
            ...$configuration->only(['uuid', 'revision', 'definition_hash', 'definition', 'created_at']),
            'profile_artifact_uuid' => $artifact?->uuid ?? ($configuration->definition['profile_artifact_uuid'] ?? null),
            'profile_uuid' => $artifact?->profile?->uuid,
            'profile_name' => $artifact?->profile?->name,
            'profile_revision' => $artifact?->revision,
        ];
    }

    public static function gateway(SparkplugGateway $gateway): array
    {
        return [...$gateway->only(['uuid', 'name', 'edge_node_id', 'presence', 'last_seen_at']),
            'presence' => $gateway->presence === 'online' && (! $gateway->runtime_seen_at || $gateway->runtime_seen_at->lt(now()->subSeconds(20))) ? 'unknown' : $gateway->presence,
            'connection_uuid' => $gateway->connection->uuid, 'group_id' => $gateway->connection->group_id,
            'sources_count' => $gateway->candidates_count ?? $gateway->candidates()->count()];
    }

    public static function candidate(DiscoveryCandidate $candidate): array
    {
        return [...$candidate->only(['uuid', 'source_device_id', 'status', 'presence', 'session_id', 'birth_revision', 'metrics', 'last_seen_at']),
            'assigned_device_uuid' => $candidate->assignedDevice?->uuid,
            'gateway' => self::gateway($candidate->gateway)];
    }

    public static function command(DeviceCommand $command): array
    {
        return [...$command->only(['uuid', 'parameter_uuid', 'value', 'status', 'confirmed_at', 'expires_at', 'sent_at', 'completed_at', 'diagnostic', 'created_at']),
            'actor_name' => User::find($command->created_by)?->name ?? 'Former user',
            'configuration_uuid' => $command->configuration->uuid];
    }
}
