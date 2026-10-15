<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Administration\Http\Resources\Concerns\KnowsGrantablePermissions;
use App\Domain\Authorization\Models\Role;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrganizationInvitationResource extends JsonResource
{
    use KnowsGrantablePermissions;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'email' => $this->email,
            'role_ids' => $this->role_ids,
            'roles' => $this->whenLoaded('roles', fn (): array => $this->roleSummaries()),
            'grants_super_admin' => (bool) $this->grants_super_admin,
            // Null for a super-administrator invitation, which belongs to no organization.
            'organization' => $this->whenLoaded('organization', fn (): ?array => $this->organization === null ? null : [
                'uuid' => $this->organization->uuid,
                'name' => $this->organization->name,
                'slug' => $this->organization->slug,
            ]),
            'invited_by' => $this->whenLoaded('invitedBy', fn (): ?array => $this->invitedBy === null ? null : [
                'id' => (int) $this->invitedBy->getKey(),
                'name' => $this->invitedBy->name,
            ]),
            // Manageable: the actor could resend or revoke it without handing out access they lack.
            'manageable' => $this->when($this->grantable !== null && $this->relationLoaded('roles'), fn (): bool => $this->roles
                ->flatMap(fn ($role) => $role->permissions->pluck('name'))
                ->diff($this->grantable)
                ->isEmpty()),
            'expires_at' => $this->expires_at,
            'accepted_at' => $this->accepted_at,
            'revoked_at' => $this->revoked_at,
            'status' => $this->accepted_at !== null
                ? 'accepted'
                : ($this->revoked_at !== null ? 'revoked' : ($this->expires_at->isPast() ? 'expired' : 'pending')),
        ];
    }

    /**
     * @return list<array{id: int, display_name: string}>
     */
    private function roleSummaries(): array
    {
        return $this->roles
            ->map(fn (Role $role): array => [
                'id' => (int) $role->getKey(),
                'display_name' => (string) $role->display_name,
            ])
            ->values()
            ->all();
    }
}
