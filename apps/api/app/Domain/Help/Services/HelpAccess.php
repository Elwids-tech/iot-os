<?php

declare(strict_types=1);

namespace App\Domain\Help\Services;

use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Spatie\Permission\PermissionRegistrar;

final class HelpAccess
{
    public function organization(User $user, Organization $organization): void
    {
        abort_unless($user->is_super_admin || $user->organizations()->whereKey($organization->id)->exists(), 403);
    }

    public function capabilities(User $user, Organization $organization): array
    {
        $this->organization($user, $organization);
        $devices = app(DeviceAuthorization::class)->capabilities($user, $organization);
        $profiles = app(DeviceProfileAuthorization::class)->capabilities($user, $organization);
        $registrar = app(PermissionRegistrar::class);
        $previous = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->id);
        $user->unsetRelation('roles')->unsetRelation('permissions');
        try {
            return [
                'devices.view' => $devices['view'] ?? false,
                'devices.manage' => $devices['manage'] ?? false,
                'profiles.view' => $profiles['view'] ?? false,
                'workflows.view' => $user->is_super_admin || $user->checkPermissionTo('Workflow.view'),
            ];
        } finally {
            $registrar->setPermissionsTeamId($previous);
            $user->unsetRelation('roles')->unsetRelation('permissions');
        }
    }

    public function permits(array $article, array $capabilities): bool
    {
        foreach ($article['required_capabilities'] as $capability) {
            if (! ($capabilities[$capability] ?? false)) {
                return false;
            }
        }

        return true;
    }
}
