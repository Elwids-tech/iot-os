<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Http;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceAssignment;
use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

final class LocationMapController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly RuntimeClient $runtime, private readonly LocationBindingController $bindings) {}

    public function query(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $input = $request->validate(['device_uuids' => 'required|array|min:1|max:100', 'device_uuids.*' => 'required|uuid|distinct',
            'trail_window' => 'required|in:1h,6h,24h,7d', 'include_trails' => 'required|boolean', 'geofence_uuid' => 'nullable|uuid']);
        abort_unless(Device::where('organization_id', $organization->id)->whereIn('uuid', $input['device_uuids'])->count() === count($input['device_uuids']), 404);
        $seconds = ['1h' => 3600, '6h' => 21600, '24h' => 86400, '7d' => 604800][$input['trail_window']];
        $items = [];
        $contexts = [];
        foreach (LocationBinding::where('organization_id', $organization->id)->with('device')->whereHas('device', fn ($q) => $q->whereIn('uuid', $input['device_uuids']))->get() as $binding) {
            $assignment = GeofenceAssignment::where('device_location_binding_id', $binding->id)
                ->when($input['geofence_uuid'] ?? null, fn ($query, $uuid) => $query->whereIn('geofence_id', Geofence::where('uuid', $uuid)->select('id')))
                ->first();
            $workflow = $assignment ? Workflow::find($assignment->automation_workflow_id) : null;
            $contexts[$binding->uuid] = compact('assignment', 'workflow');
            $items[] = ['binding' => $this->bindings->view($organization, $binding), 'operation_uuid' => $workflow?->applied_deployment_uuid,
                'device_name' => $binding->device->name];
        }
        $result = $this->runtime->request('POST', '/internal/locations/map', ['organization_uuid' => $organization->uuid,
            'items' => $items, 'from' => now()->subSeconds($seconds)->toIso8601String(), 'to' => now()->toIso8601String(),
            'include_trails' => $input['include_trails'], 'max_points' => 200,
            'retention_days' => app(RetentionService::class)->effective($organization)['days']]);
        $result['devices'] ??= [];
        foreach ($result['devices'] as &$device) {
            ['assignment' => $assignment, 'workflow' => $workflow] = $contexts[data_get($device, 'binding_uuid')] ?? ['assignment' => null, 'workflow' => null];
            $alert = $assignment ? Alert::where('automation_workflow_id', $assignment->automation_workflow_id)->whereNull('cleared_at')->first() : null;
            $device['wandering'] = (bool) $alert;
            $device['active_alert'] = $alert?->only(['uuid', 'activated_at']);
            $device['assignment_status'] = $assignment?->status;
            $device['deployment_status'] = $workflow?->deployment_status;
        }
        unset($device);

        return ['data' => ['schema_version' => 'location-map.v1', 'trail_window' => $input['trail_window'],
            'geofence' => isset($input['geofence_uuid']) ? Geofence::where('organization_id', $organization->id)->where('uuid', $input['geofence_uuid'])->first()?->only(['uuid', 'name', 'geometry', 'revision']) : null,
            'devices' => $result['devices'] ?? []]];
    }
}
