<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Authorization\Models\PlatformRole;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class PlatformTeamMemberResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (int) $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'is_super_admin' => (bool) $this->is_super_admin,
            'platform_roles' => $this->whenLoaded('platformRoles', fn (): array => $this->platformRoleSummaries()),
        ];
    }

    /**
     * @return list<array{key: string, display_name: string}>
     */
    private function platformRoleSummaries(): array
    {
        return $this->platformRoles
            ->map(fn (PlatformRole $role): array => [
                'key' => (string) $role->key,
                'display_name' => (string) $role->display_name,
            ])
            ->values()
            ->all();
    }
}
