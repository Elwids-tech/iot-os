<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services\Batch;

/**
 * Where a batch item points: an existing entity by UUID, an earlier item by its ref, or
 * (for a new entity's parent only) the top level when both are null.
 */
final readonly class EntityRef
{
    public function __construct(public ?string $uuid, public ?string $ref) {}

    public static function existing(string $uuid): self
    {
        return new self($uuid, null);
    }

    public static function item(string $ref): self
    {
        return new self(null, $ref);
    }

    public static function topLevel(): self
    {
        return new self(null, null);
    }
}
