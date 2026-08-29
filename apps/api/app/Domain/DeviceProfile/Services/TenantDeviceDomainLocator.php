<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceManagement\Models\Device;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceProfile\Models\DeviceProfile;
use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Models\Organization;

final class TenantDeviceDomainLocator
{
    public function profile(Organization $organization, string $uuid): DeviceProfile
    {
        return DeviceProfile::query()->whereBelongsTo($organization)->where('uuid', $uuid)->firstOrFail();
    }

    public function profileVersion(Organization $organization, string $uuid): DeviceProfileVersion
    {
        return DeviceProfileVersion::query()->whereBelongsTo($organization)->where('uuid', $uuid)->firstOrFail();
    }

    public function binding(Organization $organization, string $uuid): TransportBinding
    {
        return TransportBinding::query()->whereBelongsTo($organization)->where('uuid', $uuid)->firstOrFail();
    }

    public function bindingVersion(Organization $organization, string $uuid): TransportBindingVersion
    {
        return TransportBindingVersion::query()->whereBelongsTo($organization)->where('uuid', $uuid)->firstOrFail();
    }

    public function device(Organization $organization, string $uuid): Device
    {
        return Device::query()->whereBelongsTo($organization)->where('uuid', $uuid)->firstOrFail();
    }

    public function gateway(Organization $organization, string $uuid): Gateway
    {
        return Gateway::query()->whereBelongsTo($organization)->where('uuid', $uuid)->firstOrFail();
    }

    public function gatewayRoute(Organization $organization, string $uuid): GatewayRoute
    {
        return GatewayRoute::query()->whereBelongsTo($organization)->where('uuid', $uuid)->firstOrFail();
    }
}
