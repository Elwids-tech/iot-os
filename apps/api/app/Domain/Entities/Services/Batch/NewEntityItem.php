<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services\Batch;

/**
 * An entity to create (spec 009, contracts/hierarchy-operations.md). Its parent is an
 * existing entity, an earlier item of the same batch, or the top level.
 *
 * @param  array<string, string|int|float|bool|null>  $attributes
 */
final readonly class NewEntityItem
{
    public function __construct(
        public string $ref,
        public string $typeKey,
        public string $name,
        public ?string $pathName = null,
        public EntityRef $parent = new EntityRef(null, null),
        public ?string $timezone = null,
        public ?string $address = null,
        public ?float $latitude = null,
        public ?float $longitude = null,
        public array $attributes = [],
    ) {}
}
