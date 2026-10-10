<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\UpsertOrganizationRoleRequest;
use App\Domain\Administration\Http\Resources\OrganizationRoleResource;
use App\Domain\Administration\Http\Resources\TenantPermissionResource;
use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationGrants;
use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Administration\Services\OrganizationRoleManager;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\RolePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\UserPermission;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;

final class OrganizationRoleController
{
    public function __construct(
        private readonly OrganizationAdministrationAuthorization $authorization,
        private readonly OrganizationRoleManager $roles,
        private readonly OrganizationPermissionCeiling $ceiling,
        private readonly OrganizationGrants $grants,
    ) {}

    /**
     * Inviting people and changing their roles both need the role list to choose from.
     */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        /** @var User $actor */
        $actor = $request->user();
        abort_unless(collect([RolePermission::VIEW_ANY, UserPermission::CREATE, UserPermission::UPDATE])
            ->contains(fn (RolePermission|UserPermission $permission): bool => $this->authorization->allows($actor, $organization, $permission->value)), 403);
        $grantable = $this->grants->grantable($actor, $organization);

        $roles = Role::query()
            ->where('organization_id', $organization->getKey())
            ->with('permissions')
            ->addSelect(['members_count' => DB::table(config('permission.table_names.model_has_roles'))
                ->selectRaw('count(*)')
                ->whereColumn('role_id', 'roles.id')])
            ->orderByDesc('is_default')
            ->orderBy('display_name')
            ->get();

        return OrganizationRoleResource::collection(
            $roles->map(fn (Role $role) => (new OrganizationRoleResource($role))->withGrantable($grantable)),
        );
    }

    /**
     * The organization's ceiling, each flagged with whether the actor can grant it.
     */
    public function permissions(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $actor = $this->authorize($request, $organization, RolePermission::VIEW_ANY->value);
        $grantable = $this->grants->grantable($actor, $organization);

        return TenantPermissionResource::collection(
            $this->ceiling->permissionsFor($organization)
                ->map(fn (Permission $permission) => (new TenantPermissionResource($permission))->withGrantable($grantable)),
        );
    }

    public function store(UpsertOrganizationRoleRequest $request, Organization $organization): JsonResponse
    {
        $actor = $this->authorize($request, $organization, RolePermission::CREATE->value);

        /** @var array{display_name: string, permission_names: list<string>} $validated */
        $validated = $request->validated();
        $role = $this->roles->create($organization, $actor, $validated['display_name'], $validated['permission_names']);

        return (new OrganizationRoleResource($role))->withGrantable($this->grants->grantable($actor, $organization))
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpsertOrganizationRoleRequest $request, Organization $organization, Role $role): JsonResource
    {
        $actor = $this->authorize($request, $organization, RolePermission::UPDATE->value);
        $this->ensureRoleBelongsToOrganization($role, $organization);

        /** @var array{display_name: string, permission_names: list<string>} $validated */
        $validated = $request->validated();
        $role = $this->roles->update($role, $actor, $validated['display_name'], $validated['permission_names']);

        return (new OrganizationRoleResource($role))->withGrantable($this->grants->grantable($actor, $organization));
    }

    public function destroy(Request $request, Organization $organization, Role $role): Response
    {
        $actor = $this->authorize($request, $organization, RolePermission::DELETE->value);
        $this->ensureRoleBelongsToOrganization($role, $organization);
        $this->roles->delete($role, $actor);

        return response()->noContent();
    }

    private function authorize(Request $request, Organization $organization, string $permission): User
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless($this->authorization->allows($user, $organization, $permission), 403);

        return $user;
    }

    private function ensureRoleBelongsToOrganization(Role $role, Organization $organization): void
    {
        abort_unless($role->organization_id === $organization->getKey(), 404);
    }
}
