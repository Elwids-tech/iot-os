<?php

declare(strict_types=1);

namespace App\Domain\Shared\Concurrency;

use RuntimeException;

final class PreconditionRequired extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('An If-Match precondition is required for this resource.');
    }
}
