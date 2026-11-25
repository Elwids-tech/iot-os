<?php

declare(strict_types=1);

namespace App\Domain\Entities\Models;

use App\Domain\Devices\Models\Device;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A device's position at an entity for a period (spec 009, FR-009). A device has at most
 * one current placement; ended ones are its history. `started_at` is null only for the
 * placements the site migration opened ("since before placement history was kept").
 *
 * @property array<string, string>|null $leaf_names parameter UUID => leaf name (PR 4)
 */
final class EntityPlacement extends EntityModel
{
    public const MOVED = 'moved';

    public const UNPLACED = 'unplaced';

    public const DEVICE_ARCHIVED = 'device_archived';

    public const MOVED_OUT = 'moved_out';

    public const ENTITY_ARCHIVED = 'entity_archived';

    public $timestamps = false;

    protected $table = 'entity_placements';

    protected function casts(): array
    {
        return ['leaf_names' => 'array', 'started_at' => 'datetime', 'ended_at' => 'datetime'];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function entity(): BelongsTo
    {
        return $this->belongsTo(Entity::class);
    }
}
