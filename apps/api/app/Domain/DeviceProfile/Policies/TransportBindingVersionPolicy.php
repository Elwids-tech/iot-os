<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Policies;

use App\Domain\Authorization\Services\TenantPermissionAuthorization;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Permissions\TransportBindingPermission;
use App\Domain\Shared\Models\User;

final readonly class TransportBindingVersionPolicy
{
    public function __construct(private TenantPermissionAuthorization $authorization) {}

    public function view(User $user, TransportBindingVersion $version): bool
    {
        return $this->authorization->allows($user, $version->organization, TransportBindingPermission::VIEW);
    }

    public function update(User $user, TransportBindingVersion $version): bool
    {
        return $version->isDraft()
            && $this->catalogIsActive($version)
            && $this->authorization->allows($user, $version->organization, TransportBindingPermission::UPDATE);
    }

    public function delete(User $user, TransportBindingVersion $version): bool
    {
        return $version->isDraft()
            && $this->catalogIsActive($version)
            && $this->authorization->allows($user, $version->organization, TransportBindingPermission::DELETE);
    }

    public function publish(User $user, TransportBindingVersion $version): bool
    {
        return $version->isDraft()
            && $this->catalogIsActive($version)
            && $this->authorization->allows($user, $version->organization, TransportBindingPermission::PUBLISH);
    }

    public function retire(User $user, TransportBindingVersion $version): bool
    {
        return $version->isPublished()
            && $this->authorization->allows($user, $version->organization, TransportBindingPermission::RETIRE);
    }

    private function catalogIsActive(TransportBindingVersion $version): bool
    {
        $binding = $version->binding()->with('profile')->firstOrFail();

        return ! $binding->isArchived() && ! $binding->profile->isArchived();
    }
}
