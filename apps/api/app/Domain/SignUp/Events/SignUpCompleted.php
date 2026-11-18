<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A sign-up created its person, billing account and organization (spec 035 FR-020).
 * Dispatched after the creating transaction commits, so listeners read what exists.
 */
final class SignUpCompleted implements ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(public readonly int $signUpId) {}
}
