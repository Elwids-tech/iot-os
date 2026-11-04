<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/** Published profile revisions for starters, resolved within one organization (constitution III). */
final class StarterProfiles
{
    public function __construct(private readonly DeviceProfileAuthorization $authorization) {}

    /**
     * A published artifact of this organization's profile, with every published revision up
     * to it, as StarterBuilder takes it. Another organization's or an unknown artifact is a
     * 404; a profile the person may not view is a 403.
     *
     * @return array{artifact_uuid: string, profile_uuid: string, revisions: list<array{revision: int, definition: array}>}
     */
    public function artifact(string $uuid, Organization $organization, User $user): array
    {
        $artifact = DeviceProfileArtifact::where('uuid', $uuid)->with('profile')->first();
        abort_unless($artifact?->profile && $artifact->profile->organization_id === $organization->id, 404);
        $this->authorizeView($organization, $user);

        return $this->load($artifact);
    }

    /** The profile's newest published revision, or null when it has none or may not be viewed. */
    public function latest(string $profileUuid, Organization $organization, User $user): ?array
    {
        $profile = DeviceProfile::where('uuid', $profileUuid)->where('organization_id', $organization->id)->first();
        if (! $profile || ! $this->authorization->capabilities($user, $organization)['view']) {
            return null;
        }
        $artifact = DeviceProfileArtifact::where('device_profile_id', $profile->id)->orderByDesc('revision')->first();

        return $artifact ? $this->load($artifact->setRelation('profile', $profile)) : null;
    }

    public function load(DeviceProfileArtifact $artifact): array
    {
        $revisions = DeviceProfileArtifact::where('device_profile_id', $artifact->device_profile_id)
            ->where('revision', '<=', $artifact->revision)->orderBy('revision')->get(['revision', 'definition']);

        return [
            'artifact_uuid' => $artifact->uuid,
            'profile_uuid' => $artifact->profile->uuid,
            'revisions' => $revisions->map(fn (DeviceProfileArtifact $revision): array => ['revision' => $revision->revision, 'definition' => $revision->definition])->all(),
        ];
    }

    public function authorizeView(Organization $organization, User $user): void
    {
        abort_unless($this->authorization->capabilities($user, $organization)['view'], 403);
    }
}
