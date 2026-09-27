<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Geospatial\Http\LocationBindingController;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceActivationBatch;
use App\Domain\Geospatial\Models\GeofenceAssignment;
use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Geospatial\Services\GeofenceService;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

final class GeospatialController
{
    public function __construct(private readonly GeofenceService $geofences, private readonly RuntimeClient $runtime, private readonly LocationBindingController $bindings) {}

    public function index(Request $request, Organization $organization): array
    {
        $app = $request->attributes->get('integration_application');

        return ['data' => Geofence::whereIn('id', $this->fenceIds($organization, $app->device_uuids))->orderBy('name')->get()
            ->map(fn ($fence) => $this->filtered($this->geofences->view($fence), $app->device_uuids))->values()];
    }

    public function show(Request $request, Organization $organization, string $uuid): array
    {
        $app = $request->attributes->get('integration_application');
        $fence = Geofence::where('organization_id', $organization->id)->whereIn('id', $this->fenceIds($organization, $app->device_uuids))->where('uuid', $uuid)->firstOrFail();

        return ['data' => $this->filtered($this->geofences->view($fence), $app->device_uuids)];
    }

    public function store(Request $request, Organization $organization)
    {
        $app = $request->attributes->get('integration_application');
        $input = $this->input($request, 0);
        $this->authorizeDevices($organization, $app->device_uuids, array_column($input['assignments'], 'device_uuid'));

        return response()->json($this->geofences->saveAndActivate($organization, null, $input, null, $app->uuid), 202);
    }

    public function update(Request $request, Organization $organization, string $uuid)
    {
        $app = $request->attributes->get('integration_application');
        $fence = Geofence::where('organization_id', $organization->id)->where('uuid', $uuid)->firstOrFail();
        abort_unless(count(array_diff($this->deviceUuids($fence), $app->device_uuids)) === 0, 403, 'This geofence contains assignments outside the application grant.');
        $input = $this->input($request, $fence->revision);
        $this->authorizeDevices($organization, $app->device_uuids, array_column($input['assignments'], 'device_uuid'));

        return response()->json($this->geofences->saveAndActivate($organization, $fence, $input, null, $app->uuid), 202);
    }

    public function activation(Request $request, Organization $organization, string $uuid, string $batch): array
    {
        $app = $request->attributes->get('integration_application');
        $fence = Geofence::where('organization_id', $organization->id)->where('uuid', $uuid)->firstOrFail();
        abort_unless(count(array_diff($this->deviceUuids($fence), $app->device_uuids)) === 0, 403);

        return ['data' => $this->geofences->batch(GeofenceActivationBatch::where('geofence_id', $fence->id)->where('uuid', $batch)->firstOrFail())];
    }

    public function retry(Request $request, Organization $organization, string $uuid, string $batch, int $item): array
    {
        $app = $request->attributes->get('integration_application');
        $fence = Geofence::where('organization_id', $organization->id)->where('uuid', $uuid)->firstOrFail();
        abort_unless(count(array_diff($this->deviceUuids($fence), $app->device_uuids)) === 0, 403);
        $record = GeofenceActivationBatch::where('geofence_id', $fence->id)->where('uuid', $batch)->firstOrFail();

        return ['data' => $this->geofences->retry($record, $item)];
    }

    public function map(Request $request, Organization $organization): array
    {
        $app = $request->attributes->get('integration_application');
        $input = $request->validate(['device_uuids' => 'required|array|min:1|max:100', 'device_uuids.*' => 'required|uuid|distinct',
            'trail_window' => 'required|in:1h,6h,24h,7d', 'include_trails' => 'required|boolean', 'geofence_uuid' => 'nullable|uuid']);
        $this->authorizeDevices($organization, $app->device_uuids, $input['device_uuids']);
        $seconds = ['1h' => 3600, '6h' => 21600, '24h' => 86400, '7d' => 604800][$input['trail_window']];
        $items = [];
        $contexts = [];
        foreach (LocationBinding::where('organization_id', $organization->id)->with('device')->whereHas('device', fn ($q) => $q->whereIn('uuid', $input['device_uuids']))->get() as $binding) {
            $assignment = GeofenceAssignment::where('device_location_binding_id', $binding->id)
                ->when($input['geofence_uuid'] ?? null, fn ($query, $id) => $query->whereIn('geofence_id', Geofence::where('uuid', $id)->select('id')))->first();
            $workflow = $assignment ? Workflow::find($assignment->automation_workflow_id) : null;
            $contexts[$binding->uuid] = compact('assignment', 'workflow');
            $items[] = ['binding' => $this->bindings->view($organization, $binding), 'operation_uuid' => $workflow?->applied_deployment_uuid, 'device_name' => $binding->device->name];
        }
        $result = $this->runtime->request('POST', '/internal/locations/map', ['organization_uuid' => $organization->uuid, 'items' => $items,
            'from' => now()->subSeconds($seconds)->toIso8601String(), 'to' => now()->toIso8601String(), 'include_trails' => $input['include_trails'],
            'max_points' => 200, 'retention_days' => app(RetentionService::class)->effective($organization)['days']]);
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

    private function input(Request $request, int $revision): array
    {
        return $request->validate(['operation_uuid' => 'required|uuid', 'expected_revision' => 'sometimes|integer|min:0', 'name' => 'required|string|max:255',
            'geometry' => 'required|array:type,coordinates', 'geometry.type' => 'required|in:Polygon', 'geometry.coordinates' => 'required|array|size:1',
            'geometry.coordinates.0' => 'required|array|min:4|max:257', 'geometry.coordinates.0.*' => 'required|array|size:2',
            'geometry.coordinates.0.*.0' => 'required|numeric|between:-180,180', 'geometry.coordinates.0.*.1' => 'required|numeric|between:-75,75',
            'assignments' => 'required|array|min:1|max:100', 'assignments.*.device_uuid' => 'required|uuid|distinct',
            'assignments.*.policy.outside_for_seconds' => 'required|integer|between:0,86400', 'assignments.*.policy.max_gap_seconds' => 'required|integer|between:1,86400',
            'assignments.*.policy.minimum_samples' => 'required|integer|between:1,1000', 'assignments.*.policy.uncertainty_metres' => 'required|numeric|between:0,100000']) + ['expected_revision' => $revision];
    }

    private function authorizeDevices(Organization $organization, array $grant, array $requested): void
    {
        abort_unless(count(array_diff($requested, $grant)) === 0 && Device::where('organization_id', $organization->id)->whereIn('uuid', $requested)->count() === count($requested), 403, 'A requested device is outside the application grant.');
    }

    private function fenceIds(Organization $organization, array $devices)
    {
        return GeofenceAssignment::where('organization_id', $organization->id)->whereIn('device_location_binding_id', LocationBinding::whereHas('device', fn ($q) => $q->whereIn('uuid', $devices))->select('id'))->select('geofence_id');
    }

    private function deviceUuids(Geofence $fence): array
    {
        return LocationBinding::whereIn('id', GeofenceAssignment::where('geofence_id', $fence->id)->select('device_location_binding_id'))->with('device')->get()->pluck('device.uuid')->all();
    }

    private function filtered(array $fence, array $devices): array
    {
        $fence['assignments'] = collect($fence['assignments'])->filter(fn ($assignment) => in_array($assignment['device']['uuid'], $devices, true))->values();

        return $fence;
    }
}
