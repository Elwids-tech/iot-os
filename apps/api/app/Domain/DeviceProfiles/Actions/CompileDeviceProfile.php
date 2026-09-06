<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Actions;

use App\Domain\DeviceProfiles\Data\CompiledProfileDefinition;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\ProfileDefinitionCompiler;

final class CompileDeviceProfile
{
    public function __construct(
        private readonly ValidateDeviceProfile $validate,
        private readonly ProfileDefinitionCompiler $compiler,
    ) {}

    public function handle(DeviceProfile $profile, ?int $revision = null): CompiledProfileDefinition
    {
        $this->validate->handle($profile);

        return $this->compiler->compile($profile, $revision);
    }
}
