<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services\Batch;

/** The outcome of a check or an apply, item by item in batch order. */
final readonly class BatchResult
{
    /** @param  list<ItemOutcome>  $items */
    public function __construct(public bool $applied, public array $items, public ?string $batchUuid = null) {}

    public function accepted(): bool
    {
        foreach ($this->items as $item) {
            if (! $item->accepted()) {
                return false;
            }
        }

        return true;
    }

    /** @return list<ItemOutcome> */
    public function refused(): array
    {
        return array_values(array_filter($this->items, fn (ItemOutcome $item): bool => ! $item->accepted()));
    }
}
