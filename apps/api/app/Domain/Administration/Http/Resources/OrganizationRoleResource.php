<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Administration\Http\Resources\Concerns\KnowsGrantablePermissions;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrganizationRoleResource extends JsonResource
{
    use KnowsGrantablePermissions;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $isAdministrator = $this->name === OrganizationRoleName::ORGANIZATION_ADMIN->value;

        return [
            'id' => $this->id,
            'key' => $this->name,
            'display_name' => $this->display_name,
            'is_default' => (bool) $this->is_default,
            'is_administrator' => $isAdministrator,
            'members_count' => $this->whenHas('members_count', fn (): int => (int) $this->members_count),
            // Assignable: every permission in the role is one the actor can grant.
            'assignable' => $this->when($this->grantable !== null && $this->relationLoaded('permissions'), fn (): bool => $this->permissions
                ->pluck('name')
                ->diff($this->grantable)
                ->isEmpty()),
            // Manageable: the actor could edit or delete the role. Organization Admin follows the ceiling.
            'manageable' => $this->when($this->grantable !== null && $this->relationLoaded('permissions'), fn (): bool => ! $isAdministrator
                && $this->permissions->pluck('name')->diff($this->grantable)->isEmpty()),
            'permissions' => $this->whenLoaded('permissions', fn () => $this->permissions->map(fn ($permission): array => [
                'name' => $permission->name,
                'group' => $permission->group,
            ])->values()),
        ];
    }
}
