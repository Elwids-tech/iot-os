<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrganizationInvitationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'email' => $this->email,
            'role_ids' => $this->role_ids,
            'roles' => $this->whenLoaded('roles', fn (): array => $this->roles
                ->map(fn ($role): array => [
                    'id' => $role->getKey(),
                    'display_name' => $role->display_name,
                ])
                ->values()
                ->all()),
            'organization' => $this->whenLoaded('organization', fn (): array => [
                'uuid' => $this->organization->uuid,
                'name' => $this->organization->name,
                'slug' => $this->organization->slug,
            ]),
            'expires_at' => $this->expires_at,
            'accepted_at' => $this->accepted_at,
            'revoked_at' => $this->revoked_at,
            'status' => $this->accepted_at !== null
                ? 'accepted'
                : ($this->revoked_at !== null ? 'revoked' : ($this->expires_at->isPast() ? 'expired' : 'pending')),
        ];
    }
}
