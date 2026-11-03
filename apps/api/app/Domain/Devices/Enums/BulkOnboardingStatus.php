<?php

declare(strict_types=1);

namespace App\Domain\Devices\Enums;

/** Where a bulk onboarding run stands (spec 026 US5); the last three roll up from its items. */
enum BulkOnboardingStatus: string
{
    case Queued = 'queued';
    case Running = 'running';
    case Succeeded = 'succeeded';
    case PartialFailure = 'partial_failure';
    case Failed = 'failed';

    public function finished(): bool
    {
        return in_array($this, [self::Succeeded, self::PartialFailure, self::Failed], true);
    }
}
