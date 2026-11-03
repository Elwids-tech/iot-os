<?php

declare(strict_types=1);

namespace App\Domain\Devices\Enums;

/**
 * One source in a bulk onboarding run. `active` is never stored: the run reads it from
 * the device's applied configuration, so it never claims what the runtime has not
 * acknowledged (constitution II).
 */
enum BulkOnboardingItemStatus: string
{
    case Pending = 'pending';
    case ActivationRequested = 'activation_requested';
    case Skipped = 'skipped';
    case Failed = 'failed';
}
