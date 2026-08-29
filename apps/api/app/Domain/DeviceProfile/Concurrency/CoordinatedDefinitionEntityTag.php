<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Concurrency;

use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\Shared\Concurrency\PreconditionRequired;
use App\Domain\Shared\Concurrency\StaleEntityTag;

final readonly class CoordinatedDefinitionEntityTag
{
    private function __construct(private string $value) {}

    public static function for(DeviceProfileVersion $profileVersion, TransportBindingVersion $bindingVersion): self
    {
        return new self(sprintf(
            '"definition-draft-%s-p%d-b%d"',
            $bindingVersion->uuid,
            $profileVersion->revision,
            $bindingVersion->revision,
        ));
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
