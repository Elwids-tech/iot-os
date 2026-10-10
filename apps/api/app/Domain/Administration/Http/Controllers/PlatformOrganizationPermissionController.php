<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\UpdateOrganizationPermissionsRequest;
use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;
use Spatie\Permission\Models\Permission;

/**
 * The permission ceiling: which tenant permissions an organization's roles may hold.
 */
final class PlatformOrganizationPermissionController
{
    public function __construct(private readonly OrganizationPermissionCeiling $ceiling) {}

    public function show(Organization $organization): JsonResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->resource($organization);
    }

    public function update(UpdateOrganizationPermissionsRequest $request, Organization $organization): JsonResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        /** @var array{restricted: bool, permission_names?: list<string>} $validated */
        $validated = $request->validated();
        $this->ceiling->update($organization, $validated['restricted'], $validated['permission_names'] ?? []);

        return $this->resource($organization->fresh());
    }

    private function resource(Organization $organization): JsonResource
    {
        return new JsonResource([
            'organization' => [
                'uuid' => $organization->uuid,
                'name' => $organization->name,
                'slug' => $organization->slug,
            ],
            'restricted' => $organization->permissions_restricted,
            'permission_names' => $this->ceiling->namesFor($organization),
            'catalogue' => $this->ceiling->catalogue()
                ->map(fn (Permission $permission): array => ['name' => $permission->name, 'group' => $permission->group])
                ->values(),
        ]);
    }
}
