<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Entities\Exceptions\HierarchyRuleBroken;
use App\Domain\Entities\Http\Resources\ParameterPlacementResource;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Services\EntityAuthorization;
use App\Domain\Entities\Services\EntityPoints;
use App\Domain\Entities\Services\ParameterPlacements;
use App\Domain\Shared\Models\Organization;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Points: parameters as they appear in the hierarchy (spec 009 US2, US4). */
final class PointController
{
    public function __construct(private readonly EntityAuthorization $authorization) {}

    /**
     * The points at the entity, or in its branch with `branch=1`, by path, 50 a page, with
     * their latest values (null when unknown, never zero).
     *
     * @return array{data: list<array{leaf_name: string, path: string, relative_path: string, device: array{uuid: string, name: string}, parameter: array{uuid: string, key: string, label: string, unit: string|null}, via: 'placement'|'parameter_placement', state: 'placed'|'name_clash'|'not_in_configuration', latest: array{value: string|int|float|bool, quality: string|null, observed_at: string|null, received_at: string|null}|null}>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    #[QueryParameter('branch', description: '1 to include the entity\'s coverage: every entity below it, and below its current members (each point keeps its own path).', type: 'int')]
    #[QueryParameter('page', type: 'int')]
    public function index(Request $request, Organization $organization, Entity $entity): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization, $entity);
        $filters = $request->validate(['branch' => ['sometimes', 'boolean'], 'page' => ['sometimes', 'integer', 'min:1']]);

        return app(EntityPoints::class)->page($entity->load('organization'), (bool) ($filters['branch'] ?? false), (int) ($filters['page'] ?? 1));
    }

    /** Places one parameter at an entity under a leaf name (default: its key). */
    public function update(Request $request, Organization $organization, Device $device, string $parameter): ParameterPlacementResource
    {
        $this->authorize($request, $organization, $device);
        $values = $request->validate(['entity_uuid' => ['required', 'uuid'], 'leaf_name' => ['sometimes', 'nullable', 'string', 'max:64']]);
        $entity = Entity::query()->where('organization_id', $organization->id)->where('uuid', $values['entity_uuid'])->first()
            ?? throw HierarchyRuleBroken::rule('not_found', 'entity_uuid', 'Choose a place in this organization.');
        $placement = app(ParameterPlacements::class)->place($device, $parameter, $entity, $values['leaf_name'] ?? null, $request->user());
        // PUT sets where the parameter is: 200 whether or not a row was created.
        $placement->wasRecentlyCreated = false;

        return new ParameterPlacementResource($placement->load('entity'));
    }

    /** Returns the parameter to its device's placement. */
    public function destroy(Request $request, Organization $organization, Device $device, string $parameter): Response
    {
        $this->authorize($request, $organization, $device);
        app(ParameterPlacements::class)->end($device, $parameter, $request->user());

        return response()->noContent();
    }

    private function authorize(Request $request, Organization $organization, Device $device): void
    {
        app(DeviceAuthorization::class)->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization);
    }
}
