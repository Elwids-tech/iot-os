<?php

declare(strict_types=1);

namespace App\Domain\Administration\Exceptions;

use RuntimeException;

final class OrganizationNotEmptyException extends RuntimeException
{
    /**
     * @param  list<array{key: string, label: string, count: int}>  $blockers
     */
    public function __construct(public readonly array $blockers)
    {
        parent::__construct('This organization still holds data that blocks deletion.');
    }
}
