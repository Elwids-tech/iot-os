<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Resources;

use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\Shared\Http\Resources\OrganizationResource;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class AuthenticatedUserResource extends JsonResource
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
            'email_verified_at' => $this->email_verified_at?->toIso8601String(),
            'is_super_admin' => (bool) $this->is_super_admin,
            'capabilities' => [
                'platform_administration' => app(PlatformAuthorization::class)->canAccessAdministration($this->resource),
                'manage_retention' => app(PlatformAuthorization::class)->allows($this->resource, \App\Domain\Authorization\Permissions\PlatformAdministrationPermission::MANAGE_RETENTION),
            ],
            'organizations' => OrganizationResource::collection(
                $this->is_super_admin
                    ? Organization::query()->orderBy('name')->get()
                    : $this->whenLoaded('organizations'),
            ),
        ];
    }
}
