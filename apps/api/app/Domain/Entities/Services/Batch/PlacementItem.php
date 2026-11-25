<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services\Batch;

/**
 * A device to place at an existing entity or at an entity created earlier in the batch.
 *
 * @param  array<string, string>  $leafNames  parameter UUID => leaf name
 */
final readonly class PlacementItem
{
    public function __construct(
        public string $ref,
        public string $deviceUuid,
        public EntityRef $entity,
        public array $leafNames = [],
    ) {}
}
