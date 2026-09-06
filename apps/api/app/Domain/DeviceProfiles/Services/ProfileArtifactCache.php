<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use Illuminate\Contracts\Cache\Repository;

final class ProfileArtifactCache
{
    public function __construct(private readonly Repository $cache) {}

    public function cache(DeviceProfileArtifact $artifact): void
    {
        $artifact->loadMissing('profile');
        $profileUuid = $artifact->profile->uuid;
        $payload = [
            'definition' => $artifact->definition,
            'definition_hash' => $artifact->definition_hash,
            'revision' => $artifact->revision,
        ];

        $this->cache->forever($this->revisionKey($profileUuid, $artifact->revision), $payload);
        $this->cache->forever($this->activeKey($profileUuid), [
            'definition_hash' => $artifact->definition_hash,
            'revision' => $artifact->revision,
        ]);
    }

    public function activeKey(string $profileUuid): string
    {
        return "device-profile:{$profileUuid}:active";
    }

    public function revisionKey(string $profileUuid, int $revision): string
    {
        return "device-profile:{$profileUuid}:{$revision}";
    }
}
