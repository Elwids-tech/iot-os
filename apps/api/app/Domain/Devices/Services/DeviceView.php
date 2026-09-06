<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\User;

final class DeviceView
{
    public static function device(Device $device, bool $detail = false): array
    {
        $presence = $device->presence;
        if ($presence === 'online' && (! $device->runtime_seen_at || $device->runtime_seen_at->lt(now()->subSeconds(20)))) {
            $presence = 'unknown';
        }
        $data = $device->only(['uuid', 'code', 'name', 'serial_number', 'description', 'lifecycle', 'deployment_status', 'draft_revision', 'deployment_generation', 'desired_configuration_uuid', 'applied_configuration_uuid', 'diagnostic', 'last_seen_at']);
        $data['presence'] = $presence;
        $data['candidate'] = $device->candidate ? self::candidate($device->candidate) : null;
        if ($detail) {
            $data['retention'] = app(RetentionService::class)->effective($device->organization);
            $data['draft'] = $device->draft;
            $artifact = isset($device->draft['artifact_uuid']) ? DeviceProfileArtifact::where('uuid', $device->draft['artifact_uuid'])->first() : null;
            $data['draft_artifact'] = $artifact ? [...$artifact->only(['uuid', 'revision', 'definition_hash', 'definition', 'status', 'compiled_at']), 'profile_uuid' => $artifact->profile->uuid] : null;
            $data['configurations'] = $device->configurations()->orderByDesc('revision')->get()->map(fn ($c) => self::configuration($c));
        }

        return $data;
    }

    public static function configuration(DeviceConfiguration $configuration): array
    {
        return $configuration->only(['uuid', 'revision', 'definition_hash', 'definition', 'created_at']);
    }

    public static function gateway(SparkplugGateway $gateway): array
    {
        return [...$gateway->only(['uuid', 'name', 'edge_node_id', 'presence', 'last_seen_at']),
            'presence' => $gateway->presence === 'online' && (! $gateway->runtime_seen_at || $gateway->runtime_seen_at->lt(now()->subSeconds(20))) ? 'unknown' : $gateway->presence,
            'connection_uuid' => $gateway->connection->uuid, 'group_id' => $gateway->connection->group_id,
            'sources_count' => $gateway->candidates()->count()];
    }

    public static function candidate(DiscoveryCandidate $candidate): array
    {
        return [...$candidate->only(['uuid', 'source_device_id', 'status', 'presence', 'session_id', 'birth_revision', 'metrics', 'last_seen_at']),
            'assigned_device_uuid' => Device::where('reserved_source_uuid', $candidate->uuid)->value('uuid'),
            'gateway' => self::gateway($candidate->gateway)];
    }

    public static function command(DeviceCommand $command): array
    {
        return [...$command->only(['uuid', 'parameter_uuid', 'value', 'status', 'confirmed_at', 'expires_at', 'sent_at', 'completed_at', 'diagnostic', 'created_at']),
            'actor_name' => User::find($command->created_by)?->name ?? 'Former user',
            'configuration_uuid' => $command->configuration->uuid];
    }
}
