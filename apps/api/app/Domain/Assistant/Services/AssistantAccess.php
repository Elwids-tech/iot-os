<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Automation\Services\DagAuthorization;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Help\Services\HelpAccess;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

final class AssistantAccess
{
    public function capabilities(User $user, Organization $organization): array
    {
        return app(DeviceProfileAuthorization::class)->capabilities($user, $organization);
    }

    public function organization(User $user, Organization $organization): void
    {
        abort_unless($user->is_super_admin || $user->organizations()->whereKey($organization->getKey())->exists(), 403);
        $capabilities = $this->capabilities($user, $organization);
        abort_unless(($capabilities['view'] ?? false) || ($capabilities['create'] ?? false), 403);
    }

    public function conversation(User $user, Organization $organization, AssistantConversation $conversation): void
    {
        abort_unless($conversation->user_id === $user->getKey() && $conversation->organization_id === $organization->getKey(), 404);
        if ($conversation->scope === 'adapter') {
            abort_unless(config('adapters.enabled') && $conversation->adapter, 404);
            app(DeviceAuthorization::class)->authorize($user, DevicePermission::MANAGE, $organization, $conversation->adapter);

            return;
        }
        if ($conversation->scope === 'help') {
            app(HelpAccess::class)->organization($user, $organization);
            abort_unless($conversation->device_profile_id === null && $conversation->automation_workflow_id === null, 422);

            return;
        }
        if ($conversation->scope === 'automation') {
            $this->automation($user, $organization);
            if ($conversation->automation_workflow_id !== null) {
                abort_unless($conversation->workflow?->organization_id === $organization->id, 404);
            }

            return;
        }
        abort_unless($conversation->scope === 'profile', 422, 'Unknown assistant scope.');
        $this->organization($user, $organization);
        if ($conversation->device_profile_id !== null) {
            abort_unless($conversation->profile?->organization_id === $organization->getKey(), 404);
            abort_unless($this->capabilities($user, $organization)['view'] ?? false, 403);
        }
    }

    public function write(AssistantConversation $conversation): void
    {
        abort_unless($conversation->scope === 'profile', 422, 'This conversation is for automation drafts.');
        $this->conversation($conversation->user, $conversation->organization, $conversation);
        $capability = $conversation->device_profile_id === null ? 'create' : 'update';
        abort_unless($this->capabilities($conversation->user, $conversation->organization)[$capability] ?? false, 403);
        abort_if($conversation->profile?->status->value === 'archived', 422, 'Archived profiles cannot be edited.');
    }

    public function automation(User $user, Organization $organization): void
    {
        $auth = app(DagAuthorization::class);
        $auth->authorize($user, $organization, 'manage');
        $auth->enabled($organization);
    }

    public function profile(User $user, Organization $organization, string $uuid): DeviceProfile
    {
        $this->organization($user, $organization);
        abort_unless($this->capabilities($user, $organization)['view'] ?? false, 403);

        return DeviceProfile::query()->where('organization_id', $organization->getKey())->where('uuid', $uuid)->firstOrFail();
    }
}
