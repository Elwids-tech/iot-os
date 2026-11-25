<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services\Batch;

use InvalidArgumentException;

/**
 * Entity creations and placements checked or applied together (spec 009, FR-024).
 * 1–2,000 items with unique refs; an item may refer only to an earlier item.
 */
final readonly class HierarchyBatch
{
    /** @var list<NewEntityItem|PlacementItem> */
    public array $items;

    /** @param  list<NewEntityItem|PlacementItem>  $items */
    public function __construct(array $items)
    {
        $limit = (int) config('entities.batch_items', 2000);
        if ($items === [] || count($items) > $limit) {
            throw new InvalidArgumentException("A batch holds 1 to {$limit} items.");
        }
        $seen = [];
        foreach ($items as $item) {
            if (isset($seen[$item->ref])) {
                throw new InvalidArgumentException("The ref {$item->ref} is used twice.");
            }
            $target = $item instanceof NewEntityItem ? $item->parent : $item->entity;
            if ($target->ref !== null && ! isset($seen[$target->ref])) {
                throw new InvalidArgumentException("Item {$item->ref} refers to {$target->ref}, which is not an earlier item.");
            }
            if ($item instanceof PlacementItem && $target->ref === null && $target->uuid === null) {
                throw new InvalidArgumentException("Placement {$item->ref} names no entity.");
            }
            $seen[$item->ref] = $item instanceof NewEntityItem;
        }
        $this->items = array_values($items);
    }
}
