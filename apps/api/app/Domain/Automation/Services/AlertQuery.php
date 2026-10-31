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
     * @param  array{condition?: string, acknowledged?: bool, device?: string, workflow?: string, assignee?: int, site?: string}  $input
     */
    public function filtered(Organization $organization, array $input): Builder
    {
        $query = Alert::where('automation_alerts.organization_id', $organization->id);
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
        $alerts->loadMissing(['workflow', 'deployment', 'acknowledger:id,name', 'assignee:id,name', 'subjectDevice:id,uuid,name']);
        $deviceNames = Device::where('organization_id', $organization->id)->whereIn('uuid', $alerts->map(fn ($a) => self::boundDevice($a))->filter()->values())->pluck('name', 'uuid')->all();
        $listed = $this->listedDevices($organization, $alerts);

        return $alerts->map(fn ($a) => $this->view($a, $deviceNames, $listed[$a->id] ?? ['devices' => [], 'total' => 0]))->all();
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

    private function view(Alert $alert, array $deviceNames, array $listed): array
    {
        $workflow = $alert->isWorkflow();
        $device = $workflow ? self::boundDevice($alert) : $alert->subjectDevice?->uuid;

        return [
            ...$alert->only(['uuid', 'episode', 'activated_at', 'cleared_at', 'acknowledged_at', 'acknowledged_by', 'assigned_at', 'activation_transition_id', 'clear_transition_id']),
            'kind' => $alert->kind ?? Alert::WORKFLOW,
            'severity' => $alert->severity ?? 'warning',
            'workflow_uuid' => $alert->workflow?->uuid, 'workflow_name' => $alert->workflow?->name, 'operation_uuid' => $alert->deployment?->uuid,
            'device_uuid' => $device, 'device_name' => $workflow ? ($deviceNames[$device] ?? null) : $alert->subjectDevice?->name,
            'devices' => $listed['devices'], 'devices_total' => $listed['total'],
            'acknowledged_by_name' => $alert->acknowledger?->name, 'assignee' => $alert->assignee?->only(['id', 'name']),
            'condition' => $alert->cleared_at ? 'cleared' : 'active', 'execution_stopped_reason' => $alert->deployment?->stopped_reason,
        ];
    }
}
