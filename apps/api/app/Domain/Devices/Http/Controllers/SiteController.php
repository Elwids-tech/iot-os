<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Entities\Services\EntityTree;
use App\Domain\Entities\Services\Placements;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

final class SiteController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return [
            'data' => Site::query()->where('organization_id', $organization->id)->withCount('devices')->orderBy('name')->get()->map->toView(),
            'organization_timezone' => $organization->timezone,
        ];
    }

    /** A top-level entity of the Site type (spec 009): the hierarchy's rules, the sites API's shape. */
    public function store(Request $request, Organization $organization)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $values = $this->values($request, $organization);
        $site = DB::transaction(function () use ($organization, $values, $request): Site {
            $entity = app(EntityTree::class)->create($organization, [...$values, 'type_key' => EntityType::SITE, 'path_name' => Site::freePathName($organization->id, $values['name'])], $request->user(), log: false);
            $site = Site::query()->findOrFail($entity->id);
            ActivityLog::record('site.created', $organization, $request->user(), $site);

            return $site;
        });

        return response()->json(['data' => $site->loadCount('devices')->toView()], 201);
    }

    public function update(Request $request, Organization $organization, Site $site): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $site);
        $fields = ['name', 'timezone', 'address', 'latitude', 'longitude'];
        $before = $site->only($fields);
        $values = $this->values($request, $organization, $site);
        $site = DB::transaction(function () use ($organization, $site, $values, $request, $before, $fields): Site {
            app(EntityTree::class)->update(Entity::query()->findOrFail($site->id), $values, $request->user(), log: false);
            $site = Site::query()->findOrFail($site->id);
            $changes = ActivityChanges::between($before, $site->only($fields));
            if ($changes !== []) {
                ActivityLog::record('site.updated', $organization, $request->user(), $site, [], $changes);
            }

            return $site;
        });

        return ['data' => $site->loadCount('devices')->toView()];
    }

    /**
     * Refused while entities sit under the site. Otherwise the devices placed at it are
     * unplaced (they fall back to the organization's time zone, as before), the site
     * entity is archived, and application scopes naming it lose it with the
     * consequences of a grant change (spec 030).
     */
    public function destroy(Request $request, Organization $organization, Site $site): Response
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $site);
        DB::transaction(function () use ($request, $organization, $site): void {
            $entity = Entity::query()->findOrFail($site->id);
            if ($entity->children()->whereNull('archived_at')->exists()) {
                throw ValidationException::withMessages(['site' => 'Move or archive the entities under '.$site->name.' first.']);
            }
            $placements = app(Placements::class);
            foreach (EntityPlacement::query()->where('entity_id', $entity->id)->whereNull('ended_at')->with('device')->get() as $placement) {
                $placements->end($placement->device, $request->user(), EntityPlacement::ENTITY_ARCHIVED, false);
            }
            // Devices given this site without a placement (older fixtures) lose it too.
            Device::query()->where('site_id', $entity->id)->whereNull('entity_id')->update(['site_id' => null]);
            app(EntityTree::class)->archive($entity, $request->user(), log: false);
            ActivityLog::record('site.deleted', $organization, $request->user(), $site);
        });

        return response()->noContent();
    }

    /** The organization's zone applies to devices without a site. */
    public function updateOrganizationTimezone(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $values = $request->validate(['timezone' => ['present', 'nullable', 'timezone:all']]);
        $before = $organization->timezone;
        $organization->forceFill(['timezone' => $values['timezone']])->save();
        ActivityLog::record('organization.timezone.updated', $organization, $request->user(), $organization, ['timezone' => $values['timezone']], ActivityChanges::between(['timezone' => $before], ['timezone' => $organization->timezone]));

        return ['data' => ['timezone' => $organization->timezone]];
    }

    private function values(Request $request, Organization $organization, ?Site $site = null): array
    {
        $values = $request->validate([
            'name' => [$site ? 'sometimes' : 'required', 'string', 'max:120', function (string $attribute, mixed $value, \Closure $fail) use ($organization, $site): void {
                // Names stay unique among the organization's active sites, as before.
                if (Site::query()->where('organization_id', $organization->id)->whereRaw('lower(name) = ?', [mb_strtolower(trim((string) $value))])->when($site, fn ($q) => $q->whereKeyNot($site->id))->exists()) {
                    $fail('The name has already been taken.');
                }
            }],
            'timezone' => [$site ? 'sometimes' : 'required', 'timezone:all'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
            // Not "sometimes": a coordinate sent alone must fail required_with.
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
        ]);
        if (isset($values['name'])) {
            $values['name'] = trim($values['name']);
        }

        return $values;
    }
}
