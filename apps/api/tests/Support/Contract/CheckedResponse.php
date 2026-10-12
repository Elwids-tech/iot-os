<?php

declare(strict_types=1);

namespace Tests\Support\Contract;

/**
 * The outcome of checking one response against the contract.
 */
final readonly class CheckedResponse
{
    /**
     * @param  string  $operation  `METHOD /path` as in the contract
     * @param  list<string>  $failures  G4 failure lines; empty when the response conforms
     */
    public function __construct(
        public string $operation,
        public int $status,
        public array $failures,
    ) {}

    public function passed(): bool
    {
        return $this->failures === [];
    }
}
