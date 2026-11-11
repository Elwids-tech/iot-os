<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Connectivity\Services\ConnectivitySettings;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\Pipes;
use App\Domain\Notifications\Services\EventRecorder;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use ValueError;

/**
 * Projects device.connectivity.v1 (spec 018) into automation_alerts: one alert per
 * episode of a device, gateway or adapter source, keyed by `<subject_key>#<episode>`.
 * Pull request 2 records alerts, the event log and the audit trail and notifies
 * nobody: no deliveries, no bell notifications, no integration events.
 *
 * A hosted organization's gateway episode (spec 031, research R14) names the gateway's
 * own organization in `subject.pipe_organization_uuid`. Its alert is the hosted
 * organization's, keyed `gateway:<connection>/<edge>@<organization uuid>#<episode>`, with
 * the pipe's gateway as its subject, which that organization sees by name only.
 */
final class ConnectivityProjector
{
    private const KINDS = ['device' => Alert::DEVICE_OFFLINE, 'gateway' => Alert::GATEWAY_OFFLINE, 'source' => Alert::CONNECTION_LOST];

    private const TRANSITIONS = ['opened', 'cleared', 'stopped'];

    public function __construct(private readonly ConnectivitySettings $settings, private readonly Pipes $pipes) {}

    /**
     * Runs inside the runtime inbox transaction. Returns false when the organization has
     * no such device, gateway or adapter (deleted since, or another organization's).
     *
     * @param  string  $event  the envelope uuid, kept as the transition's id
     */
    public function project(array $payload, string $event): bool
    {
        $transition = $payload['transition'];
        if (! in_array($transition, self::TRANSITIONS, true) || ! is_string($payload['at'] ?? null)) {
            throw new ValueError('Unknown connectivity transition or a transition without its time.');
        }
        $organization = Organization::where('uuid', $payload['organization_uuid'])->lockForUpdate()->first();
        if (! $organization) {
            return false;
        }
        // Every identity is resolved inside the event's organization (constitution III), or
        // for a hosted gateway episode through Pipes, inside its billing account (ADR-039).
        [$subject, $key] = $this->subject($organization, $payload['subject'], $payload['affected_device_uuids'] ?? []);
        if (! $subject) {
            return false;
        }
        $key .= '#'.(int) $payload['episode'];
        $alert = Alert::where('episode_key', $key)->lockForUpdate()->first();
        $at = CarbonImmutable::parse($payload['at'])->utc();
        $closing = $transition !== 'opened';
        if ($alert && ($closing ? $alert->clear_transition_id !== null : $alert->activation_transition_id !== null)) {
            return true;
        }
        // Laravel ended it when its device moved; the runtime's late transitions change nothing.
        if ($alert?->stopped_reason === Alert::STOPPED_DEVICE_MOVED) {
            return true;
        }
        $values = [
            'cause' => $payload['cause'] ?? null,
            'offline_since' => $payload['offline_since'] ?? null,
            'last_seen_at' => $payload['last_heard_at'] ?? null,
            'last_observed_at' => $payload['last_observed_at'] ?? null,
            'threshold_seconds' => $payload['offline_after_seconds'] ?? null,
            'threshold_automatic' => $payload['offline_after_automatic'] ?? null,
            'reporting_interval_seconds' => $payload['reporting_interval_seconds'] ?? null,
            'poll_interval_seconds' => $payload['poll_interval_seconds'] ?? null,
            'grace_seconds' => $payload['grace_seconds'] ?? null,
        ];
        if (! $alert) {
            // A clear or stop that arrives first is recorded as history: it never invents an activation.
            $alert = Alert::create([
                'organization_id' => $organization->id, 'kind' => self::KINDS[$payload['subject']['kind']],
                'severity' => $this->settings->severity($subject instanceof Device ? $subject : null),
                'episode' => (int) $payload['episode'], 'episode_key' => $key, $this->column($subject) => $subject->id,
                'activated_at' => $closing ? ($payload['offline_since'] ?? $at) : $at, ...$values,
            ]);
            $devices = Device::where('organization_id', $organization->id)->whereIn('uuid', $payload['affected_device_uuids'])->pluck('id');
            $alert->devices()->attach($devices->all());
        } elseif (! $closing) {
            // The opening arrived after its clear: it brings the episode's true activation time.
            $alert->update(['activated_at' => $at, ...array_filter($values, fn ($value) => $value !== null)]);
        }
        if ($closing) {
            $alert->update(['clear_transition_id' => $event, 'cleared_at' => $at, 'stopped_reason' => $transition === 'stopped' ? $payload['stop_reason'] : null]);
        } else {
            $alert->update(['activation_transition_id' => $event]);
            if ($alert->cleared_at) {
                // History only: the episode already ended, so nothing is recorded as active.
                return true;
            }
        }
        app(EventRecorder::class)->connectivity($alert, $transition, $subject->name, $at->toIso8601String());
        DeviceAudit::record('alert.'.$transition, $organization->id, null, $alert->uuid, ['episode' => $alert->episode, 'kind' => $alert->kind, 'cause' => $alert->cause, 'stopped_reason' => $alert->stopped_reason]);

        return true;
    }

    /**
     * The subject record and its runtime key, or null when the organization has none.
     *
     * @param  list<string>  $affected
     * @return array{0: ?Model, 1: string}
     */
    private function subject(Organization $organization, array $subject, array $affected): array
    {
        $pipe = $subject['pipe_organization_uuid'] ?? null;
        if ($pipe !== null) {
            return [$subject['kind'] === 'gateway' ? $this->pipes->hostedGateway($organization, $pipe, $subject['connection_uuid'], $subject['edge_node_id'], $affected) : null,
                'gateway:'.$subject['connection_uuid'].'/'.$subject['edge_node_id'].'@'.$organization->uuid];
        }

        return match ($subject['kind']) {
            'device' => [Device::where('organization_id', $organization->id)->where('uuid', $subject['device_uuid'])->first(['id', 'uuid', 'name', 'organization_id']), 'device:'.$subject['device_uuid']],
            'gateway' => [SparkplugGateway::where('organization_id', $organization->id)->where('edge_node_id', $subject['edge_node_id'])
                ->whereIn('sparkplug_connection_id', SparkplugConnection::where('organization_id', $organization->id)->where('uuid', $subject['connection_uuid'])->select('id'))->first(['id', 'uuid', 'name', 'organization_id']),
                'gateway:'.$subject['connection_uuid'].'/'.$subject['edge_node_id']],
            'source' => [DeviceAdapter::where('organization_id', $organization->id)->where('uuid', $subject['adapter_uuid'])->first(['id', 'uuid', 'name', 'organization_id']), 'source:'.$subject['adapter_uuid']],
            default => throw new ValueError('Unknown connectivity subject.'),
        };
    }

    private function column(Model $subject): string
    {
        return match (true) {
            $subject instanceof Device => 'subject_device_id',
            $subject instanceof SparkplugGateway => 'subject_gateway_id',
            default => 'subject_adapter_id',
        };
    }
}
