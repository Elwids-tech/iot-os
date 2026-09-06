<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Exceptions;

use RuntimeException;

final class ProfileDraftConflictException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('This profile was changed by another author. Reload it before saving.');
    }
}
