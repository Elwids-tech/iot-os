<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\UpsertOrganizationRoleRequest;
use App\Domain\Administration\Http\Resources\OrganizationRoleResource;
use App\Domain\Administration\Http\Resources\TenantPermissionResource;
use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationRoleManager;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Permissions\RolePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;
use Spatie\Permission\Models\Permission;

final class OrganizationRoleController
{
    public function __construct(
        private readonly OrganizationAdministrationAuthorization $authorization,
        private readonly OrganizationRoleManager $roles,
    ) {}

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorize($request, $organization, RolePermission::VIEW_ANY->value);

        return OrganizationRoleResource::collection(
            Role::query()
                ->where('organization_id', $organization->getKey())
                ->with('permissions')
                ->orderByDesc('is_default')
                ->orderBy('display_name')
                ->get(),
        );
    }

    public function permissions(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorize($request, $organization, RolePermission::VIEW_ANY->value);

        return TenantPermissionResource::collection(
            Permission::query()
                ->where('guard_name', 'web')
                ->whereNotIn('name', array_map(
                    static fn (PlatformAdministrationPermission $permission): string => $permission->value,
                    PlatformAdministrationPermission::cases(),
                ))
                ->orderBy('group')
                ->orderBy('name')
                ->get(),
        );
    }

    public function store(UpsertOrganizationRoleRequest $request, Organization $organization): JsonResponse
    {
        $this->authorize($request, $organization, RolePermission::CREATE->value);

        /** @var array{display_name: string, permission_names: list<string>} $validated */
        $validated = $request->validated();

        return OrganizationRoleResource::make(
            $this->roles->create($organization, $validated['display_name'], $validated['permission_names']),
        )->response()->setStatusCode(201);
    }

    public function update(UpsertOrganizationRoleRequest $request, Organization $organization, Role $role): JsonResource
    {
        $this->authorize($request, $organization, RolePermission::UPDATE->value);
        $this->ensureRoleBelongsToOrganization($role, $organization);

        /** @var array{display_name: string, permission_names: list<string>} $validated */
        $validated = $request->validated();

        return OrganizationRoleResource::make(
            $this->roles->update($role, $validated['display_name'], $validated['permission_names']),
        );
    }

    public function destroy(Request $request, Organization $organization, Role $role): Response
    {
        $this->authorize($request, $organization, RolePermission::DELETE->value);
        $this->ensureRoleBelongsToOrganization($role, $organization);
        $this->roles->delete($role);

        return response()->noContent();
    }

    private function authorize(Request $request, Organization $organization, string $permission): void
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($this->authorization->allows($user, $organization, $permission), 403);
    }

    private function ensureRoleBelongsToOrganization(Role $role, Organization $organization): void
    {
        abort_unless($role->organization_id === $organization->getKey(), 404);
    }
}
