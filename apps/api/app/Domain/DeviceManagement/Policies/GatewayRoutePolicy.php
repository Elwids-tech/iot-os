<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceManagement\Models\GatewayRoute;
use App\Domain\DeviceManagement\Permissions\GatewayRoutePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

final readonly class GatewayRoutePolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function viewAny(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, GatewayRoutePermission::VIEW_ANY);
    }

    public function view(User $user, GatewayRoute $route): bool
    {
        return $this->authorization->allows($user, $route->organization, GatewayRoutePermission::VIEW);
    }

    public function create(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, GatewayRoutePermission::CREATE);
    }

    public function update(User $user, GatewayRoute $route): bool
    {
        return $route->device->isDraft()
            && ! $route->definitionAssignment?->isLocked()
            && $this->authorization->allows($user, $route->organization, GatewayRoutePermission::UPDATE);
    }

    public function delete(User $user, GatewayRoute $route): bool
    {
        return $route->device->isDraft()
            && ! $route->definitionAssignment?->isLocked()
            && $this->authorization->allows($user, $route->organization, GatewayRoutePermission::DELETE);
    }
}
