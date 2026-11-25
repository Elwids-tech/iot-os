<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services\Batch;

/** What happened to one batch item: accepted, or refused with the rule it broke. */
final readonly class ItemOutcome
{
    public function __construct(
        public string $ref,
        public string $outcome,
        public ?string $rule = null,
        public ?string $field = null,
        public ?string $message = null,
        /** Set for an accepted entity item once applied; null on a check. */
        public ?string $entityUuid = null,
    ) {}

    public function accepted(): bool
    {
        return $this->outcome === 'accepted';
    }
}
