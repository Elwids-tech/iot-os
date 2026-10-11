<?php

declare(strict_types=1);

namespace App\Domain\Shared\Http\Resources;

use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationGrants;
use App\Domain\Dashboards\Services\DashboardAccess;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Devices\Services\DeviceAuthorization;
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
                'device_profiles' => app(DeviceProfileAuthorization::class)->capabilities($user, $this->resource),
                'devices' => app(DeviceAuthorization::class)->capabilities($user, $this->resource),
                'dashboards' => app(DashboardAccess::class)->capabilities($user, $this->resource),
                'manage_administration' => app(OrganizationAdministrationAuthorization::class)->allows(
                    $user,
                    $this->resource,
                    OrganizationPermission::UPDATE->value,
                ),
                'administration' => app(OrganizationGrants::class)->capabilities($user, $this->resource),
                // Optional platform features, so clients can hide entry points the API would 404.
                'features' => [
                    'device_adapters' => (bool) config('adapters.enabled'),
                ],
            ]),
        ];
    }
}
