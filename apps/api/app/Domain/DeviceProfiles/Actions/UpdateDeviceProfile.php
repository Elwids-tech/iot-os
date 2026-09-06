<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Actions;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\Shared\Models\User;

final class UpdateDeviceProfile
{
    public function __construct(private readonly DeviceProfileAuthoring $authoring) {}

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function handle(DeviceProfile $profile, User $actor, array $attributes, ?int $expectedDraftRevision): DeviceProfile
    {
        $result = $this->authoring->mutate(
            $profile,
            $actor,
            $expectedDraftRevision,
            static function (DeviceProfile $locked) use ($attributes): null {
                $locked->fill($attributes);

                return null;
            },
        );

        return $result['profile'];
    }
}
