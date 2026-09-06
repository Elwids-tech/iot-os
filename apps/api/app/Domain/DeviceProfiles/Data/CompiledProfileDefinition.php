<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Data;

final readonly class CompiledProfileDefinition
{
    /**
     * @param  array<string, mixed>  $definition
     */
    public function __construct(
        public array $definition,
        public string $canonicalJson,
        public string $hash,
    ) {}
}
