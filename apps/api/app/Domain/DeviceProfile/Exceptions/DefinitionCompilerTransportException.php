<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Exceptions;

use RuntimeException;
use Throwable;

final class DefinitionCompilerTransportException extends RuntimeException
{
    private function __construct(
        string $message,
        public readonly ?int $statusCode = null,
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, previous: $previous);
    }

    public static function configuration(string $message): self
    {
        return new self($message);
    }

    public static function network(Throwable $previous): self
    {
        return new self('The definition compiler could not be reached within the configured limits.', previous: $previous);
    }

    public static function http(int $statusCode): self
    {
        return new self("The definition compiler returned infrastructure HTTP status {$statusCode}.", $statusCode);
    }

    public static function malformedResponse(?Throwable $previous = null): self
    {
        return new self('The definition compiler returned a malformed response.', previous: $previous);
    }
}
