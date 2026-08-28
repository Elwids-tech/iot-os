<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceProfile\Models\TransportBinding;
use App\Domain\DeviceProfile\Permissions\TransportBindingPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

final readonly class TransportBindingPolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function viewAny(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, TransportBindingPermission::VIEW_ANY);
    }

    public function view(User $user, TransportBinding $binding): bool
    {
        return $this->authorization->allows($user, $binding->organization, TransportBindingPermission::VIEW);
    }

    public function create(User $user, Organization $organization): bool
    {
        return $this->authorization->allows($user, $organization, TransportBindingPermission::CREATE);
    }

    public function update(User $user, TransportBinding $binding): bool
    {
        return ! $binding->isArchived()
            && $this->authorization->allows($user, $binding->organization, TransportBindingPermission::UPDATE);
    }

    public function delete(User $user, TransportBinding $binding): bool
    {
        return ! $binding->isArchived()
            && $this->authorization->allows($user, $binding->organization, TransportBindingPermission::DELETE);
    }
}
