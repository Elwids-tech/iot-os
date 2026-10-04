<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Http;

use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceActivationBatch;
use App\Domain\Geospatial\Services\GeofenceService;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class GeofenceController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly GeofenceService $service) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $input = $request->validate(['search' => 'sometimes|nullable|string|max:255', 'page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $page = Geofence::where('organization_id', $organization->id)
            ->when(trim($input['search'] ?? ''), fn ($query, $search) => $query->whereRaw('LOWER(name) LIKE ?', ['%'.mb_strtolower($search).'%']))
            ->orderBy('name')->paginate((int) ($input['per_page'] ?? 25), ['*'], 'page', (int) ($input['page'] ?? 1));

        return ['data' => $page->getCollection()->map(fn ($fence) => $this->service->view($fence)),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function show(Request $request, Organization $organization, Geofence $geofence): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $geofence);

        return ['data' => $this->service->view($geofence)];
    }

    public function store(Request $request, Organization $organization)
    {
        $this->write($request, $organization);

        return response()->json($this->service->saveAndActivate($organization, null, $this->input($request, 0), $request->user()->id), 202);
    }

    public function update(Request $request, Organization $organization, Geofence $geofence)
    {
        $this->write($request, $organization, $geofence);

        return response()->json($this->service->saveAndActivate($organization, $geofence, $this->input($request, $geofence->revision), $request->user()->id), 202);
    }

    public function activation(Request $request, Organization $organization, Geofence $geofence, GeofenceActivationBatch $batch): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $geofence);
        abort_unless($batch->organization_id === $organization->id && $batch->geofence_id === $geofence->id, 404);

        return ['data' => $this->service->batch($batch)];
    }

    public function events(Request $request, Organization $organization, Geofence $geofence): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $geofence);
        $input = $request->validate(['page' => ['sometimes', 'integer', 'min:1'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:100']]);
        $page = DB::table('geofence_events')->where('organization_id', $organization->id)->where('geofence_id', $geofence->id)
            ->orderByDesc('occurred_at')->paginate((int) ($input['per_page'] ?? 25));

        return ['data' => collect($page->items())->map(fn ($event) => json_decode($event->snapshot, true, 512, JSON_THROW_ON_ERROR)),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function retry(Request $request, Organization $organization, Geofence $geofence, GeofenceActivationBatch $batch, int $item): array
    {
        $this->write($request, $organization, $geofence);
        abort_unless($batch->organization_id === $organization->id && $batch->geofence_id === $geofence->id, 404);

        return ['data' => $this->service->retry($batch, $item)];
    }

    private function write(Request $request, Organization $organization, ?Geofence $geofence = null): void
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $geofence);
        $this->authorization->authorize($request->user(), DevicePermission::ACTIVATE, $organization, $geofence);
    }

    private function input(Request $request, int $defaultRevision): array
    {
        return $request->validate([
            'operation_uuid' => ['required', 'uuid'], 'expected_revision' => ['sometimes', 'integer', 'min:0'],
            'name' => ['required', 'string', 'max:255'], 'geometry' => ['required', 'array:type,coordinates'],
            'geometry.type' => ['required', 'in:Polygon'], 'geometry.coordinates' => ['required', 'array', 'size:1'],
            'geometry.coordinates.0' => ['required', 'array', 'min:4', 'max:257'],
            'geometry.coordinates.0.*' => ['required', 'array', 'size:2'],
            'geometry.coordinates.0.*.0' => ['required', 'numeric', 'between:-180,180'],
            'geometry.coordinates.0.*.1' => ['required', 'numeric', 'between:-75,75'],
            'assignments' => ['required', 'array', 'min:1', 'max:100'],
            'assignments.*' => ['required', 'array:device_uuid,policy'],
            'assignments.*.device_uuid' => ['required', 'uuid', 'distinct'],
            'assignments.*.policy' => ['required', 'array:outside_for_seconds,max_gap_seconds,minimum_samples,uncertainty_metres'],
            'assignments.*.policy.outside_for_seconds' => ['required', 'integer', 'between:0,86400'],
            'assignments.*.policy.max_gap_seconds' => ['required', 'integer', 'between:1,86400'],
            'assignments.*.policy.minimum_samples' => ['required', 'integer', 'between:1,1000'],
            'assignments.*.policy.uncertainty_metres' => ['required', 'numeric', 'between:0,100000'],
        ]) + ['expected_revision' => $defaultRevision];
    }
}
