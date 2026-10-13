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
            $query->whereHas('deployment', fn ($q) => $q->whereRaw(self::device().' = ?', [$input['device']]));
        }
        if (isset($input['site'])) {
            // Agent tools only: alerts of the devices at one site.
            $devices = Device::where('organization_id', $organization->id)->whereHas('site', fn ($q) => $q->where('uuid', $input['site']))->pluck('uuid')->all();
            $query->whereHas('deployment', fn ($q) => $devices === [] ? $q->whereRaw('1 = 0') : $q->whereIn(DB::raw(self::device()), $devices));
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

    public function views(Organization $organization, Collection $alerts): array
    {
        $alerts->loadMissing(['workflow', 'deployment', 'acknowledger:id,name', 'assignee:id,name']);
        $deviceNames = Device::where('organization_id', $organization->id)->whereIn('uuid', $alerts->map(fn ($a) => ($a->deployment->definition['binding']['device_uuid'] ?? $a->deployment->definition['bindings'][0]['device_uuid'])))->pluck('name', 'uuid')->all();

        return $alerts->map(fn ($a) => $this->view($a, $deviceNames))->all();
    }

    private function view(Alert $alert, array $deviceNames): array
    {
        $device = ($alert->deployment->definition['binding']['device_uuid'] ?? $alert->deployment->definition['bindings'][0]['device_uuid']);

        return [...$alert->only(['uuid', 'episode', 'activated_at', 'cleared_at', 'acknowledged_at', 'acknowledged_by', 'assigned_at', 'activation_transition_id', 'clear_transition_id']), 'workflow_uuid' => $alert->workflow->uuid, 'workflow_name' => $alert->workflow->name, 'operation_uuid' => $alert->deployment->uuid, 'device_uuid' => $device, 'device_name' => $deviceNames[$device] ?? null, 'acknowledged_by_name' => $alert->acknowledger?->name, 'assignee' => $alert->assignee?->only(['id', 'name']), 'condition' => $alert->cleared_at ? 'cleared' : 'active', 'execution_stopped_reason' => $alert->deployment->stopped_reason];
    }
}
