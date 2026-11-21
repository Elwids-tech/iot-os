<?php

declare(strict_types=1);

namespace App\Domain\Shared\Http\Resources;

use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Administration\Services\OrganizationGrants;
use App\Domain\Agents\Services\AgentAccess;
use App\Domain\Automation\Services\DagAuthorization;
use App\Domain\Branding\Services\Brands;
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
        $brand = app(Brands::class)->forOrganization($this->resource);

        return [
            'uuid' => $this->uuid,
            'name' => $this->name,
            'slug' => $this->slug,
            /**
             * The organization's own logo (spec 036), or null.
             *
             * @var array{url: string, width: int, height: int}|null
             */
            'logo' => $this->resource->logo?->image(),
            /** @var array{url: string, width: int, height: int}|null */
            'logo_dark' => $this->resource->logoDark?->image(),
            /**
             * What the portal shows for the organization: its own logo, else its billing
             * account's brand while that is in effect. A null `product_name` means the
             * platform's name; a null `logo` means the organization's name is shown.
             *
             * @var array{product_name: string|null, logo: array{url: string, width: int, height: int}|null, logo_dark: array{url: string, width: int, height: int}|null}
             */
            'brand' => [
                'product_name' => $brand['product_name'],
                'logo' => $brand['logo']?->image(),
                'logo_dark' => $brand['logo_dark']?->image(),
            ],
            // Members must use two-step sign-in (spec 034, FR-021).
            'two_step_required' => (bool) $this->two_step_required,
            'users_count' => $this->whenCounted('users'),
            'devices_count' => $this->whenHas('devices_count', fn (): int => (int) $this->devices_count),
            // Only the admin list and admin writes load it; members never see their billing account (spec 023).
            'billing_account' => $this->whenLoaded('billingAccount', fn (): array => [
                'uuid' => $this->billingAccount->uuid,
                'name' => $this->billingAccount->name,
            ]),
            'capabilities' => $this->when($user instanceof User, fn (): array => $this->capabilities($user)),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function capabilities(User $user): array
    {
        $manageAdministration = app(OrganizationAdministrationAuthorization::class)->allows(
            $user,
            $this->resource,
            OrganizationPermission::UPDATE->value,
        );

        return [
            'device_profiles' => app(DeviceProfileAuthorization::class)->capabilities($user, $this->resource),
            'devices' => app(DeviceAuthorization::class)->capabilities($user, $this->resource),
            'dashboards' => app(DashboardAccess::class)->capabilities($user, $this->resource),
            'automation' => app(DagAuthorization::class)->capabilities($user, $this->resource),
            'manage_administration' => $manageAdministration,
            'administration' => app(OrganizationGrants::class)->capabilities($user, $this->resource),
            // Optional platform features, so clients can hide entry points the API would 404.
            'features' => [
                'device_adapters' => (bool) config('adapters.enabled'),
                'agent_access' => app(AgentAccess::class)->deploymentEnabled(),
            ],
            // AI agent access (spec 004): the organization's switch and who may change it.
            'agents' => [
                'enabled' => (bool) $this->agent_access_enabled,
                'manage' => $manageAdministration,
            ],
        ];
    }
}
