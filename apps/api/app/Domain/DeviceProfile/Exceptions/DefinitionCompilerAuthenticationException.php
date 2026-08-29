<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Exceptions;

use RuntimeException;

final class DefinitionCompilerAuthenticationException extends RuntimeException
{
    public function __construct(public readonly int $statusCode)
    {
        parent::__construct('The definition compiler rejected the internal service credential.');
    }
}
