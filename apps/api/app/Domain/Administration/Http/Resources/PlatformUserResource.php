<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class PlatformUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'is_super_admin' => (bool) $this->is_super_admin,
            'platform_roles' => $this->whenLoaded('platformRoles', fn () => $this->platformRoles->map(fn ($role): array => [
                'key' => $role->key,
                'display_name' => $role->display_name,
            ])->values()),
            'organizations' => $this->whenLoaded('organizations', fn () => $this->organizations->map(fn ($organization): array => [
                'uuid' => $organization->uuid,
                'name' => $organization->name,
                'slug' => $organization->slug,
            ])->values()),
        ];
    }
}
