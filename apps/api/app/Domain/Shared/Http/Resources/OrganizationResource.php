<?php

declare(strict_types=1);

namespace App\Domain\Shared\Http\Resources;

use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\OrganizationPermission;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class OrganizationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();

        return [
            'uuid' => $this->uuid,
            'name' => $this->name,
            'slug' => $this->slug,
            'users_count' => $this->whenCounted('users'),
            'capabilities' => $this->when($user instanceof User, fn (): array => [
                'manage_administration' => app(OrganizationAdministrationAuthorization::class)->allows(
                    $user,
                    $this->resource,
                    OrganizationPermission::UPDATE->value,
                ),
            ]),
        ];
    }
}
