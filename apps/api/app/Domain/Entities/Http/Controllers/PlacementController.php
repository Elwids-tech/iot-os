<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Entities\Http\Resources\PlacedDeviceResource;
use App\Domain\Entities\Http\Resources\PlacementResource;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Services\EntityAuthorization;
use App\Domain\Entities\Services\Placements;
use App\Domain\Shared\Models\Organization;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Devices in the hierarchy (spec 009 US2). */
final class PlacementController
{
    public function __construct(private readonly EntityAuthorization $authorization, private readonly Placements $placements) {}

    /** Places the device at the entity, ending where it was. Returns the current placement. */
    public function update(Request $request, Organization $organization, Device $device): PlacementResource
    {
        $this->authorize($request, $organization, $device);
        $values = $request->validate(['entity_uuid' => ['required', 'uuid'], 'leaf_names' => ['sometimes', 'array', 'max:500'], 'leaf_names.*' => ['string', 'max:64']]);
        $entity = Entity::query()->where('organization_id', $organization->id)->where('uuid', $values['entity_uuid'])->first()
            ?? throw ValidationException::withMessages(['entity_uuid' => 'Choose a place in this organization.']);
        $placement = $this->placements->place($device, $entity, $request->user(), $values['leaf_names'] ?? []);
        // PUT sets where the device is: 200 whether or not a placement row was created.
        $placement->wasRecentlyCreated = false;

        return new PlacementResource($placement->load('entity'));
    }

    /** Takes the device out of the hierarchy. */
    public function destroy(Request $request, Organization $organization, Device $device): Response
    {
        $this->authorize($request, $organization, $device);
        $this->placements->end($device, $request->user());

        return response()->noContent();
    }

    /** Where the device has been, newest first. */
    public function index(Request $request, Organization $organization, Device $device): AnonymousResourceCollection
    {
        app(DeviceAuthorization::class)->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization);

        return PlacementResource::collection(EntityPlacement::query()->with('entity')->where('device_id', $device->id)
            ->orderByRaw('ended_at IS NULL DESC')->orderByDesc('ended_at')->orderByDesc('id')->paginate(50));
    }

    /** Devices placed at the entity, or anywhere in its branch with `branch=1`, by name. */
    #[QueryParameter('branch', description: '1 to include every entity below.', type: 'int')]
    #[QueryParameter('page', type: 'int')]
    public function devices(Request $request, Organization $organization, Entity $entity): AnonymousResourceCollection
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization, $entity);
        $filters = $request->validate(['branch' => ['sometimes', 'boolean'], 'page' => ['sometimes', 'integer', 'min:1']]);
        $placed = EntityPlacement::query()->whereNull('ended_at')->select('device_id')
            ->when($filters['branch'] ?? false,
                fn ($query) => $query->whereIn('entity_id', DB::table('entity_closure')->select('descendant_id')->where('ancestor_id', $entity->id)),
                fn ($query) => $query->where('entity_id', $entity->id));

        return PlacedDeviceResource::collection(Device::query()->where('organization_id', $organization->id)->whereIn('id', $placed)
            ->with('entity')->orderBy('name')->orderBy('id')->paginate(50));
    }

    private function authorize(Request $request, Organization $organization, Device $device): void
    {
        app(DeviceAuthorization::class)->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization);
    }
}
