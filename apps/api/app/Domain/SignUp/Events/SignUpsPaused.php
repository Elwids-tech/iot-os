<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Events;

use Illuminate\Foundation\Events\Dispatchable;

/**
 * The day's sign-up ceiling was reached (spec 035 FR-042). Dispatched once per UTC day.
 */
final class SignUpsPaused
{
    use Dispatchable;

    public function __construct(public readonly int $limit) {}
}
