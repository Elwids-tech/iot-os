<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class PlatformRoleResource extends JsonResource
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
            'is_default' => (bool) $this->is_default,
            'permissions_count' => (int) $this->permissions_count,
            'organization' => $this->whenLoaded('organization', fn (): array => [
                'uuid' => $this->organization->uuid,
                'name' => $this->organization->name,
                'slug' => $this->organization->slug,
            ]),
        ];
    }
}
