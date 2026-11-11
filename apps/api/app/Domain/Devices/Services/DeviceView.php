<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\DeviceOperation;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

final class DeviceView
{
    public static function operation(DeviceOperation $operation): array
    {
        return $operation->only(['uuid', 'target_state', 'kind', 'generation', 'configuration_uuid', 'status', 'diagnostic', 'created_at', 'completed_at']);
    }

    /** What the runtime reports for an adapter-fed device while its adapter restarts (spec 018, D3). */
    public const ADAPTER_RESTARTING = 'Adapter restarting; waiting for it to reconnect.';

    public const ADAPTER_PAUSED = 'Adapter paused; offline alerts resume when it is resumed.';

    /** Relations DeviceView::device reads, for lists to eager-load. */
    public const CONNECTIVITY = ['openConnectivityAlerts.subjectDevice:id,uuid,name', 'openConnectivityAlerts.subjectGateway:id,uuid,name', 'openConnectivityAlerts.subjectAdapter:id,uuid,name'];

    public static function presence(Device $device): string
    {
        return $device->presence === 'online' && (! $device->runtime_seen_at || $device->runtime_seen_at->lt(now()->subSeconds(20))) ? 'unknown' : $device->presence;
    }

    /**
     * The open offline alert concerning a device (spec 018, D14): its own, or its
     * gateway's, newest first. Null when none is open.
     *
     * @return ?array{uuid: string, kind: string, cause: ?string, since: ?string, subject: ?array{type: string, uuid: string, name: string}}
     */
    public static function offlineAlert(Device $device): ?array
    {
        $alert = $device->openConnectivityAlerts->first();

        return $alert ? self::alert($alert) : null;
    }

    private static function alert(Alert $alert): array
    {
        $subject = match (true) {
            $alert->subjectDevice !== null => ['type' => 'device', 'uuid' => $alert->subjectDevice->uuid, 'name' => $alert->subjectDevice->name],
            $alert->subjectGateway !== null => ['type' => 'gateway', 'uuid' => $alert->subjectGateway->uuid, 'name' => $alert->subjectGateway->name],
            $alert->subjectAdapter !== null => ['type' => 'adapter', 'uuid' => $alert->subjectAdapter->uuid, 'name' => $alert->subjectAdapter->name],
            default => null,
        };

        return ['uuid' => $alert->uuid, 'kind' => $alert->kind, 'cause' => $alert->cause, 'since' => ($alert->offline_since ?? $alert->activated_at)?->toJSON(), 'subject' => $subject];
    }

    /**
     * Presence and its explanation as people see them. An open offline alert shows the
     * device offline with its cause, even behind a live gateway; a lost vendor connection
     * shows it unknown. An adapter-fed device whose adapter restarts or is paused is
     * unknown, never offline.
     *
     * @return array{0: string, 1: ?string}
     */
    public static function connectivity(Device $device, ?array $alert): array
    {
        if ($alert && $alert['kind'] === Alert::CONNECTION_LOST) {
            return ['unknown', 'Connection lost'.($alert['subject'] ? ' to '.$alert['subject']['name'] : '').'; waiting for it to reconnect.'];
        }
        if ($alert) {
            return ['offline', match (true) {
                $alert['kind'] === Alert::GATEWAY_OFFLINE => 'Offline because gateway '.($alert['subject']['name'] ?? '').' is offline.',
                $alert['cause'] === 'gateway_offline' => 'Offline because '.($device->candidate?->gateway ? 'gateway '.$device->candidate->gateway->name : 'its gateway').' is offline.',
                $alert['cause'] === 'death_certificate' => 'Offline: death certificate.',
                default => 'Offline: missed check-in.',
            }];
        }
        if ($device->diagnostic === self::ADAPTER_RESTARTING && $device->openInstallation?->candidate?->adapter?->status === 'paused') {
            return ['unknown', self::ADAPTER_PAUSED];
        }

        return [self::presence($device), $device->diagnostic];
    }

    public static function device(Device $device, bool $detail = false): array
    {
        $alert = self::offlineAlert($device);
        [$presence, $diagnostic] = self::connectivity($device, $alert);
        $data = $device->only(['uuid', 'code', 'name', 'serial_number', 'description', 'lifecycle', 'deployment_status', 'draft_revision', 'deployment_generation', 'desired_configuration_uuid', 'applied_configuration_uuid', 'diagnostic', 'last_seen_at']);
        $data['presence'] = $presence;
        $data['diagnostic'] = $diagnostic;
        $data['offline_alert'] = $alert;
        $data['state_revision'] = (int) $device->state_revision;
        $data['last_applied_configuration_uuid'] = $device->last_applied_configuration_uuid;
        $data['operation'] = $device->latestOperation ? self::operation($device->latestOperation) : null;

        $pipe = app(Pipes::class)->for($device);
        $hosted = $pipe?->hosted ?? false;
        $data['candidate'] = $device->candidate ? self::candidate($device->candidate, $hosted) : null;
        // What it reports through, and where it moved (spec 031): a hosted device sees its pipe's summary only.
        $data['pipe'] = $pipe?->toArray();
        $data['link'] = self::link($device);
        $data['profile'] = self::profile($device);
        $data['site'] = self::site($device);
        $data['tags'] = $device->tags ?? [];
        $data['attributes'] = (object) ($device->custom_attributes ?? []);
        if ($detail) {
            // A hosted device's installations are on another organization's adapter, whose revisions stay there.
            $data['installations'] = DeviceInstallation::where('device_id', $device->id)->latest('started_at')->limit(20)->get()
                ->map(fn ($installation) => [...$installation->only(['uuid', 'manufacturer_serial', 'adapter_revision_uuid', 'started_at', 'ended_at']), ...($installation->organization_id === $device->organization_id ? [] : ['adapter_revision_uuid' => null])]);
            $data['retention'] = app(RetentionService::class)->effective($device->organization);
            // Calendar totals such as "today" are cut in this zone for every viewer.
            $data['reporting_timezone'] = $device->reportingTimezone();
            $data['draft'] = $device->draft;
            $artifact = isset($device->draft['artifact_uuid']) ? DeviceProfileArtifact::where('uuid', $device->draft['artifact_uuid'])->first() : null;
            $data['draft_artifact'] = $artifact ? [...$artifact->only(['uuid', 'revision', 'definition_hash', 'definition', 'status', 'compiled_at']), 'profile_uuid' => $artifact->profile->uuid] : null;
            $data['configurations'] = $device->configurations()->with('artifact.profile')->orderByDesc('revision')->get()->map(fn ($c) => self::configuration($c, $hosted));
        }

        return $data;
    }

    /**
     * The profile summary of the device's configuration, or null without one. Same rule as
     * telemetry reads: the applied configuration, else the last one the runtime confirmed.
     * Shared with the integration device read (spec 030).
     *
     * @return ?array{uuid: string, name: string, revision: int}
     */
    public static function profile(Device $device): ?array
    {
        $artifact = ($device->appliedConfiguration ?? $device->lastAppliedConfiguration)?->artifact;

        return $artifact?->profile ? ['uuid' => $artifact->profile->uuid, 'name' => $artifact->profile->name, 'revision' => $artifact->revision] : null;
    }

    /** @return ?array{uuid: string, name: string, timezone: string} */
    public static function site(Device $device): ?array
    {
        return $device->site ? $device->site->only(['uuid', 'name', 'timezone']) : null;
    }

    /**
     * A configuration snapshot. A hosted device's snapshot names its source and its own
     * installation, but not the pipe owner's connection, gateway or adapter (spec 031).
     */
    public static function configuration(DeviceConfiguration $configuration, bool $hosted = false): array
    {
        $artifact = $configuration->artifact;
        $definition = $configuration->definition;
        if ($hosted) {
            $definition['source'] = array_intersect_key($definition['source'] ?? [], array_flip(['candidate_uuid', 'device_id']));
            if (isset($definition['adapter'])) {
                $definition['adapter'] = array_intersect_key($definition['adapter'], array_flip(['installation_uuid', 'manufacturer_serial']));
            }
        }

        return [
            ...$configuration->only(['uuid', 'revision', 'definition_hash', 'created_at']),
            'definition' => $definition,
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
            'adapter' => self::publisher($gateway)?->only(['uuid', 'name']),
            'sources_count' => $gateway->candidates_count ?? $gateway->candidates()->count(),
            'offline_alert' => $gateway->offlineAlert ? self::alert($gateway->offlineAlert->setRelation('subjectGateway', $gateway)) : null];
    }

    /**
     * The device adapter a gateway publishes for, which people see in its place; null for
     * every other gateway. Adapter gateways share their organization's adapters connection,
     * already loaded with the gateway, so other gateways cost no query.
     */
    private static function publisher(SparkplugGateway $gateway): ?DeviceAdapter
    {
        return str_starts_with($gateway->connection->group_id, 'adapters-') ? $gateway->adapter : null;
    }

    /**
     * A discovered source. Its pipe owner sees, for a source in use in another
     * organization, that organization's name only (`in_use_in`). A hosted device sees its
     * source's metrics and birth revision, never the gateway or adapter behind it
     * (spec 031, ADR-039).
     */
    public static function candidate(DiscoveryCandidate $candidate, bool $hosted = false): array
    {
        $fields = $candidate->only(['uuid', 'source_device_id', 'status', 'presence', 'session_id', 'birth_revision', 'metrics', 'last_seen_at']);
        $assigned = $candidate->assignedDevice;
        if ($hosted) {
            return [...$fields, 'session_id' => null, 'assigned_device_uuid' => $assigned?->uuid, 'setup_device_uuid' => null, 'in_use_in' => null, 'gateway' => null, 'adapter' => null];
        }
        $elsewhere = $assigned !== null && $assigned->organization_id !== $candidate->organization_id;

        return [...$fields,
            'assigned_device_uuid' => $elsewhere ? null : $assigned?->uuid,
            'setup_device_uuid' => $assigned ? null : $candidate->setupDevice()?->uuid,
            'in_use_in' => $elsewhere ? self::inUseIn($assigned) : null,
            'gateway' => self::gateway($candidate->gateway), 'adapter' => self::adapterSource($candidate)];
    }

    /**
     * Where a pipe owner's source is in use when its device is in another organization:
     * that organization's name and nothing else of it.
     *
     * @return array{organization_name: string}
     */
    public static function inUseIn(Device $device): array
    {
        return ['organization_name' => (string) Organization::withTrashed()->whereKey($device->organization_id)->value('name')];
    }

    /**
     * Where the device moved to, or moved from, with the other organization's name, the
     * cutover time, and whether the readings from before the cutover are shared with the
     * target; null without a move. A device that moved on is shown as moved to.
     *
     * @return ?array{direction: string, organization_name: ?string, cutover_at: string, history: array{included: bool, stopped_at: ?string, stopped_reason: ?string}}
     */
    public static function link(Device $device): ?array
    {
        $to = $device->movedTo;
        $link = $to ?? $device->movedFrom;
        if (! $link) {
            return null;
        }
        $other = Organization::withTrashed()->whereKey($to ? $link->target_organization_id : $link->source_organization_id)->value('name');

        return ['direction' => $to ? 'moved_to' : 'moved_from', 'organization_name' => $other, 'cutover_at' => $link->cutover_at->toJSON(),
            'history' => ['included' => $link->history_included, 'stopped_at' => $link->history_stopped_at?->toJSON(), 'stopped_reason' => $link->history_stopped_reason]];
    }

    /**
     * The adapter behind a source its managed gateway reported, with the manufacturer
     * serial the adapter decoded; null for every other gateway. Such sources are
     * activated through the adapter, never mapped by hand.
     */
    public static function adapterSource(DiscoveryCandidate $candidate): ?array
    {
        $adapter = self::publisher($candidate->gateway);
        if (! $adapter) {
            return null;
        }
        $physical = $candidate->source_device_id === '' ? null
            : AdapterCandidate::where('device_adapter_id', $adapter->id)->where('sparkplug_device_id', $candidate->source_device_id)->first(['uuid', 'source_device_id']);

        return ['uuid' => $adapter->uuid, 'name' => $adapter->name, 'candidate_uuid' => $physical?->uuid, 'serial' => $physical?->source_device_id];
    }

    public static function command(DeviceCommand $command): array
    {
        return [...$command->only(['uuid', 'parameter_uuid', 'value', 'status', 'confirmed_at', 'expires_at', 'sent_at', 'completed_at', 'diagnostic', 'created_at']),
            'actor_name' => User::find($command->created_by)?->name ?? 'Former user',
            'configuration_uuid' => $command->configuration->uuid];
    }
}
