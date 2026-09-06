<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Actions;

use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use App\Domain\DeviceProfiles\Exceptions\ProfileValidationException;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\DeviceProfileValidator;

final class ValidateDeviceProfile
{
    public function __construct(private readonly DeviceProfileValidator $validator) {}

    /**
     * @return list<ProfileDiagnostic>
     */
    public function diagnostics(DeviceProfile $profile): array
    {
        return $this->validator->validate($profile);
    }

    public function handle(DeviceProfile $profile): void
    {
        $diagnostics = $this->diagnostics($profile);

        if ($diagnostics !== []) {
            throw new ProfileValidationException($diagnostics);
        }
    }
}
