<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\SyncPlatformRolePermissionsRequest;
use App\Domain\Administration\Http\Resources\PlatformRolePermissionResource;
use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Administration\Services\OrganizationRoleManager;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;

final class PlatformRolePermissionController
{
    public function __construct(
        private readonly OrganizationRoleManager $roleManager,
        private readonly OrganizationPermissionCeiling $ceiling,
    ) {}

    public function show(Request $request, Role $role): JsonResource
    {
        $this->authorize($request);

        return $this->resourceFor($this->organizationRole($role));
    }

    public function update(SyncPlatformRolePermissionsRequest $request, Role $role): JsonResource
    {
        $this->authorize($request);

        $role = $this->roleManager->syncPermissions(
            $this->organizationRole($role),
            $request->validated('permission_names'),
            $request->user(),
        );

        return $this->resourceFor($this->organizationRole($role));
    }

    private function authorize(Request $request): void
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
    }

    private function organizationRole(Role $role): Role
    {
        return Role::query()
            ->whereKey($role->getKey())
            ->whereNotNull('organization_id')
            ->with(['organization', 'permissions'])
            ->firstOrFail();
    }

    private function resourceFor(Role $role): PlatformRolePermissionResource
    {
        return new PlatformRolePermissionResource(
            $role,
            $this->ceiling->permissionsFor($role->organization),
        );
    }
}
