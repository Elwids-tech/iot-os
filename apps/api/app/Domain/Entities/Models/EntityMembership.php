<?php

declare(strict_types=1);

namespace App\Domain\Entities\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An entity grouped under another outside the tree, such as a feeder in a division (spec
 * 009, FR-023). It adds no path, time zone or placement; ended ones are its history.
 */
final class EntityMembership extends Model
{
    public $timestamps = false;

    protected $table = 'entity_memberships';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['started_at' => 'datetime', 'ended_at' => 'datetime'];
    }

    public function member(): BelongsTo
    {
        return $this->belongsTo(Entity::class, 'member_id');
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Entity::class, 'group_id');
    }

    public function groupType(): BelongsTo
    {
        return $this->belongsTo(EntityType::class, 'group_type_id');
    }
}
