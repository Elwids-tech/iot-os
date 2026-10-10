<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Administration\Http\Resources\Concerns\KnowsGrantablePermissions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrganizationMemberResource extends JsonResource
{
    use KnowsGrantablePermissions;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'is_current_user' => $request->user()?->is($this->resource) ?? false,
            'manageable' => $this->when($this->grantable !== null && $this->relationLoaded('roles'), fn (): bool => $this->roles
                ->flatMap(fn ($role) => $role->permissions->pluck('name'))
                ->diff($this->grantable)
                ->isEmpty()),
            'roles' => $this->whenLoaded('roles', fn () => OrganizationRoleResource::collection($this->roles)),
        ];
    }
}
