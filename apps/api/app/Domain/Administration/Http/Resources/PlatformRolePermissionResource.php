<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Spatie\Permission\Models\Permission;

/**
 * @extends JsonResource<Role>
 */
final class PlatformRolePermissionResource extends JsonResource
{
    /**
     * @param  Collection<int, Permission>  $availablePermissions
     */
    public function __construct(Role $resource, private readonly Collection $availablePermissions)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $assignedPermissionNames = $this->resource->permissions->pluck('name')->all();
        $permissionsEditable = $this->resource->name !== OrganizationRoleName::ORGANIZATION_ADMIN->value;

        return [
            'id' => $this->resource->id,
            'key' => $this->resource->name,
            'display_name' => $this->resource->display_name,
            'is_default' => (bool) $this->resource->is_default,
            'permissions_editable' => $permissionsEditable,
            'permission_update_message' => $permissionsEditable
                ? null
                : 'The Organization Admin permission baseline cannot be changed. Create a custom role for a different permission bundle.',
            'organization' => [
                'uuid' => $this->resource->organization->uuid,
                'name' => $this->resource->organization->name,
                'slug' => $this->resource->organization->slug,
            ],
            'permissions' => $this->availablePermissions
                ->map(fn (Permission $permission): array => [
                    'name' => $permission->name,
                    'group' => $permission->group,
                    'assigned' => in_array($permission->name, $assignedPermissionNames, true),
                ])
                ->values(),
        ];
    }
}
