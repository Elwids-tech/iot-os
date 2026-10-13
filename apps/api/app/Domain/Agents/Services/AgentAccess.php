<?php

declare(strict_types=1);

namespace App\Domain\Agents\Services;

use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\OrganizationPermission;

/**
 * The two switches for AI agent access: the deployment's (IOT_AGENTS_ENABLED) and
 * each organization's, which starts off and only its administrators change.
 */
final class AgentAccess
{
    public function deploymentEnabled(): bool
    {
        return (bool) config('agents.enabled');
    }

    public function organizationEnabled(Organization $organization): bool
    {
        return $this->deploymentEnabled() && (bool) $organization->agent_access_enabled;
    }

    public function canManage(User $user, Organization $organization): bool
    {
        return app(OrganizationAdministrationAuthorization::class)->allows($user, $organization, OrganizationPermission::UPDATE->value);
    }

    public function setEnabled(User $actor, Organization $organization, bool $enabled): void
    {
        if ((bool) $organization->agent_access_enabled === $enabled) {
            return;
        }
        $organization->forceFill(['agent_access_enabled' => $enabled, 'agent_access_changed_at' => now()])->save();
        DeviceAudit::record($enabled ? 'agents.access_enabled' : 'agents.access_disabled', $organization->id, $actor->id, $organization->uuid);
    }

    /** The address people give their agent. */
    public function connectorUrl(): string
    {
        return (string) config('agents.resource');
    }
}
