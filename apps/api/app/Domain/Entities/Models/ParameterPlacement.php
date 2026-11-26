<?php

declare(strict_types=1);

namespace App\Domain\Entities\Models;

use App\Domain\Devices\Models\Device;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One device parameter placed at an entity under a leaf name (spec 009, FR-010). It
 * overrides the device's placement for that parameter; ended ones are its history.
 */
final class ParameterPlacement extends EntityModel
{
    public $timestamps = false;

    protected $table = 'parameter_placements';

    protected function casts(): array
    {
        return ['started_at' => 'datetime', 'ended_at' => 'datetime'];
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
