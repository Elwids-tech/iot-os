<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\DeviceManagement\Permissions\GatewayPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

final readonly class GatewayPolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function viewAny(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, GatewayPermission::VIEW_ANY);
    }

    public function view(User $user, Gateway $gateway): bool
    {
        return $this->authorization->allows($user, $gateway->organization, GatewayPermission::VIEW);
    }

    public function create(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, GatewayPermission::CREATE);
    }

    public function update(User $user, Gateway $gateway): bool
    {
        return $this->authorization->allows($user, $gateway->organization, GatewayPermission::UPDATE);
    }

    public function delete(User $user, Gateway $gateway): bool
    {
        return $this->authorization->allows($user, $gateway->organization, GatewayPermission::DELETE);
    }
}
