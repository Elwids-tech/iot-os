<?php

declare(strict_types=1);

namespace App\Domain\Shared\Concurrency;

use InvalidArgumentException;
use Stringable;

final readonly class EntityTag implements Stringable
{
    private function __construct(private string $value) {}

    public static function for(string $resource, string $uuid, int $revision): self
    {
        if ($revision < 1) {
            throw new InvalidArgumentException('An entity revision must be greater than zero.');
        }

        if (preg_match('/^[a-z][a-z0-9-]*$/', $resource) !== 1) {
            throw new InvalidArgumentException('An entity tag resource key must be lowercase kebab-case.');
        }

        return new self(sprintf('"%s-%s-r%d"', $resource, $uuid, $revision));
    }

    public function assertMatches(?string $candidate): void
    {
        if ($candidate === null || trim($candidate) === '') {
            throw new PreconditionRequired;
        }

        if (! hash_equals($this->value, trim($candidate))) {
            throw new StaleEntityTag($this->value);
        }
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
