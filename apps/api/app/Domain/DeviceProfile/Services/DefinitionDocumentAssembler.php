<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Services;

use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;

final class DefinitionDocumentAssembler
{
    /** @return array<string, mixed> */
    public function profile(DeviceProfileVersion $version): array
    {
        $profile = $version->relationLoaded('profile') ? $version->profile : $version->profile()->firstOrFail();

        return [
            'schema' => 'iot.device-profile.authoring.v1',
            'profile' => [
                'uuid' => $profile->uuid,
                'key' => $profile->key,
                'name' => $profile->name,
                'description' => $profile->description,
            ],
            'version' => [
                ...$version->definition,
                'uuid' => $version->uuid,
                'version' => $version->version,
            ],
        ];
    }

    /** @return array<string, mixed> */
    public function binding(TransportBindingVersion $version): array
    {
        $binding = $version->relationLoaded('binding') ? $version->binding : $version->binding()->firstOrFail();
        $profile = $binding->relationLoaded('profile') ? $binding->profile : $binding->profile()->firstOrFail();
        $profileVersion = $version->relationLoaded('profileVersion')
            ? $version->profileVersion
            : $version->profileVersion()->firstOrFail();

        return [
            'schema' => 'iot.native-mqtt-binding.authoring.v1',
            'binding' => [
                'uuid' => $binding->uuid,
                'profile_uuid' => $profile->uuid,
                'key' => $binding->key,
                'name' => $binding->name,
                'description' => $binding->description,
                'transport' => $binding->transport,
            ],
            'version' => [
                ...$version->definition,
                'uuid' => $version->uuid,
                'profile_version_uuid' => $profileVersion->uuid,
                'version' => $version->version,
            ],
        ];
    }

    /** @return array{profile: array<string, mixed>, binding: array<string, mixed>} */
    public function coordinated(DeviceProfileVersion $profileVersion, TransportBindingVersion $bindingVersion): array
    {
        return [
            'profile' => $this->profile($profileVersion),
            'binding' => $this->binding($bindingVersion),
        ];
    }
}
