<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Exceptions;

use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use RuntimeException;

final class ProfileValidationException extends RuntimeException
{
    /**
     * @param  list<ProfileDiagnostic>  $diagnostics
     */
    public function __construct(public readonly array $diagnostics)
    {
        parent::__construct('The device profile is not valid.');
    }
}
