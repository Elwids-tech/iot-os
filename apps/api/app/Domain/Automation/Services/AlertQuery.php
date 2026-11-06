<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Finding and presenting an organization's alerts, shared by the portal's alert
 * endpoints and agent tools (spec 004). Callers check Device.view.
 */
final class AlertQuery
{
    /** At most this many of an alert's devices are listed; `devices_total` counts them all. */
    public const LISTED_DEVICES = 100;

    /**
     * @param  array{condition?: string, acknowledged?: bool, device?: string, workflow?: string, assignee?: int, site?: string, kind?: list<string>, muted?: bool}  $input
     */
    public function filtered(Organization $organization, array $input): Builder
    {
        $query = Alert::where('automation_alerts.organization_id', $organization->id);
        if (! empty($input['kind'])) {
            $query->whereIn('automation_alerts.kind', $input['kind']);
        }
        if (isset($input['muted'])) {
            // Alerts that opened while their subject was muted (spec 018 D8) are hidden unless asked for.
            $input['muted'] ? $query->whereNotNull('automation_alerts.suppressed_at') : $query->whereNull('automation_alerts.suppressed_at');
        }
        if (isset($input['condition'])) {
            $input['condition'] === 'active' ? $query->whereNull('automation_alerts.cleared_at') : $query->whereNotNull('automation_alerts.cleared_at');
        }
        if (isset($input['acknowledged'])) {
            $input['acknowledged'] ? $query->whereNotNull('automation_alerts.acknowledged_at') : $query->whereNull('automation_alerts.acknowledged_at');
        }
        if (isset($input['device'])) {
            // Workflow alerts by their execution's bound device, which may name no
            // device record; other kinds by the devices they list.
            $query->where(fn ($q) => $q->whereHas('deployment', fn ($q) => $q->whereRaw(self::device().' = ?', [$input['device']]))
                ->orWhereHas('devices', fn ($q) => $q->where('devices.uuid', $input['device'])->whereColumn('devices.organization_id', 'automation_alerts.organization_id')));
        }
        if (isset($input['site'])) {
            // Agent tools only: alerts of the devices at one site.
            $devices = Device::where('organization_id', $organization->id)->whereHas('site', fn ($q) => $q->where('uuid', $input['site']))->get(['id', 'uuid']);
            $query->where(fn ($q) => $devices->isEmpty() ? $q->whereRaw('1 = 0') : $q->whereHas('deployment', fn ($q) => $q->whereIn(DB::raw(self::device()), $devices->pluck('uuid')->all()))
                ->orWhereHas('devices', fn ($q) => $q->whereIn('devices.id', $devices->modelKeys())));
        }
        if (isset($input['workflow'])) {
            $query->whereHas('workflow', fn ($q) => $q->where('uuid', $input['workflow']));
        }
        if (isset($input['assignee'])) {
            $query->where('automation_alerts.assigned_to', $input['assignee']);
        }

        return $query;
    }

    /** The bound device of an execution snapshot: geofence workflows bind one device, DAG workflows list bindings. */
    public static function device(): string
    {
        $grammar = DB::connection()->getQueryGrammar();

        return 'coalesce('.$grammar->wrap('automation_deployments.definition->binding->device_uuid').', '.$grammar->wrap('automation_deployments.definition->bindings[0]->device_uuid').')';
    }

    /** The bound device uuid of a workflow alert's execution; null for other kinds. */
    public static function boundDevice(Alert $alert): ?string
    {
        return $alert->deployment?->definition['binding']['device_uuid'] ?? $alert->deployment?->definition['bindings'][0]['device_uuid'] ?? null;
    }

    public function views(Organization $organization, Collection $alerts): array
    {
        $alerts->loadMissing(['workflow', 'deployment', 'acknowledger:id,name', 'assignee:id,name', 'subjectDevice:id,uuid,name,site_id', 'subjectDevice.site:id,uuid,name,timezone', 'subjectGateway:id,uuid,name', 'subjectAdapter:id,uuid,name']);
        $deviceNames = Device::where('organization_id', $organization->id)->whereIn('uuid', $alerts->map(fn ($a) => self::boundDevice($a))->filter()->values())->pluck('name', 'uuid')->all();
        $listed = $this->listedDevices($organization, $alerts);
        $gatewaySites = $this->gatewaySites($organization, $alerts);

        return $alerts->map(fn ($a) => $this->view($a, $deviceNames, $listed[$a->id] ?? ['devices' => [], 'total' => 0], $gatewaySites[$a->id] ?? null))->all();
    }

    /**
     * The site of each gateway alert, when every device it lists is at that one site.
     *
     * @return array<int, array{uuid: string, name: string, timezone: ?string}>
     */
    private function gatewaySites(Organization $organization, Collection $alerts): array
    {
        $gateways = $alerts->filter(fn (Alert $alert) => $alert->kind === Alert::GATEWAY_OFFLINE);
        if ($gateways->isEmpty()) {
            return [];
        }
        $rows = DB::table('automation_alert_devices')->join('devices', 'devices.id', '=', 'automation_alert_devices.device_id')
            ->leftJoin('sites', 'sites.id', '=', 'devices.site_id')
            ->where('devices.organization_id', $organization->id)->whereIn('automation_alert_devices.automation_alert_id', $gateways->modelKeys())
            ->groupBy('automation_alert_devices.automation_alert_id')
            ->havingRaw('count(distinct coalesce(devices.site_id, 0)) = 1')
            ->selectRaw('automation_alert_devices.automation_alert_id as alert_id, max(cast(sites.uuid as varchar)) as uuid, max(sites.name) as name, max(sites.timezone) as timezone')->get();
        $sites = [];
        foreach ($rows as $row) {
            if ($row->uuid !== null) {
                $sites[$row->alert_id] = ['uuid' => (string) $row->uuid, 'name' => (string) $row->name, 'timezone' => $row->timezone];
            }
        }

        return $sites;
    }

    /**
     * The first devices of each alert by name, with how many it lists in all.
     *
     * @return array<int, array{devices: list<array{uuid: string, name: string}>, total: int}>
     */
    private function listedDevices(Organization $organization, Collection $alerts): array
    {
        if ($alerts->isEmpty()) {
            return [];
        }
        $rows = DB::query()->fromSub(DB::table('automation_alert_devices')
            ->join('devices', 'devices.id', '=', 'automation_alert_devices.device_id')
            ->where('devices.organization_id', $organization->id)
            ->whereIn('automation_alert_devices.automation_alert_id', $alerts->modelKeys())
            ->selectRaw('automation_alert_devices.automation_alert_id as alert_id, devices.uuid, devices.name, row_number() over (partition by automation_alert_devices.automation_alert_id order by devices.name, devices.id) as position, count(*) over (partition by automation_alert_devices.automation_alert_id) as total'), 'listed')
            ->where('position', '<=', self::LISTED_DEVICES)->orderBy('alert_id')->orderBy('position')->get();
        $listed = [];
        foreach ($rows as $row) {
            $listed[$row->alert_id] ??= ['devices' => [], 'total' => (int) $row->total];
            $listed[$row->alert_id]['devices'][] = ['uuid' => (string) $row->uuid, 'name' => (string) $row->name];
        }

        return $listed;
    }

    private function view(Alert $alert, array $deviceNames, array $listed, ?array $gatewaySite): array
    {
        $workflow = $alert->isWorkflow();
        $device = $workflow ? self::boundDevice($alert) : $alert->subjectDevice?->uuid;
        $subject = match (true) {
            $workflow => null,
            $alert->subjectDevice !== null => ['type' => 'device', 'uuid' => $alert->subjectDevice->uuid, 'name' => $alert->subjectDevice->name],
            $alert->subjectGateway !== null => ['type' => 'gateway', 'uuid' => $alert->subjectGateway->uuid, 'name' => $alert->subjectGateway->name],
            $alert->subjectAdapter !== null => ['type' => 'adapter', 'uuid' => $alert->subjectAdapter->uuid, 'name' => $alert->subjectAdapter->name],
            default => null,
        };
        $site = $alert->subjectDevice?->site?->only(['uuid', 'name', 'timezone']) ?? $gatewaySite;

        return [
            ...$alert->only(['uuid', 'episode', 'activated_at', 'cleared_at', 'acknowledged_at', 'acknowledged_by', 'assigned_at', 'activation_transition_id', 'clear_transition_id']),
            'kind' => $alert->kind ?? Alert::WORKFLOW,
            'severity' => $alert->severity ?? 'warning',
            'workflow_uuid' => $alert->workflow?->uuid, 'workflow_name' => $alert->workflow?->name, 'operation_uuid' => $alert->deployment?->uuid,
            'device_uuid' => $device, 'device_name' => $workflow ? ($deviceNames[$device] ?? null) : $alert->subjectDevice?->name,
            'devices' => $listed['devices'], 'devices_total' => $listed['total'],
            'acknowledged_by_name' => $alert->acknowledger?->name, 'assignee' => $alert->assignee?->only(['id', 'name']),
            'condition' => $alert->cleared_at ? 'cleared' : 'active', 'execution_stopped_reason' => $alert->deployment?->stopped_reason,
            // Device connectivity alerts (spec 018); null or false for workflow alerts.
            'subject' => $subject, 'site' => $workflow ? null : $site,
            ...$alert->only(['cause', 'offline_since', 'last_seen_at', 'last_observed_at', 'threshold_seconds', 'threshold_automatic', 'reporting_interval_seconds', 'poll_interval_seconds', 'grace_seconds', 'stopped_reason']),
            'muted' => $alert->suppressed_at !== null, 'held' => (bool) $alert->held, 'held_count' => (int) $alert->held_count,
        ];
    }
}
