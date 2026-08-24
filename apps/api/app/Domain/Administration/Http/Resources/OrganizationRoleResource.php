<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrganizationRoleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'key' => $this->name,
            'display_name' => $this->display_name,
            'is_default' => $this->is_default,
            'permissions' => $this->whenLoaded('permissions', fn () => $this->permissions->map(fn ($permission): array => [
                'name' => $permission->name,
                'group' => $permission->group,
            ])->values()),
        ];
    }
}
