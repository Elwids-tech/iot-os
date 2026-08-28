<?php

declare(strict_types=1);

namespace App\Domain\Shared\Concurrency;

use RuntimeException;

final class StaleEntityTag extends RuntimeException
{
    public function __construct(public readonly string $currentEntityTag)
    {
        parent::__construct('The supplied If-Match value is stale. Reload the resource and merge the changes.');
    }
}
