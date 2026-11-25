<?php

declare(strict_types=1);

namespace App\Domain\Entities\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A node of an organization's hierarchy: a place, a grouping or a piece of equipment
 * (spec 009). `parent_id` is the truth; `depth`, `path` and `entity_closure` are kept
 * in step by EntityTree only (research R2).
 */
final class Entity extends EntityModel
{
    protected $table = 'entities';

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            // Not "attributes": that name collides with Eloquent's internal attribute storage.
            'custom_attributes' => 'array',
            'archived_at' => 'datetime',
            'depth' => 'integer',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function type(): BelongsTo
    {
        return $this->belongsTo(EntityType::class, 'entity_type_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function changes(): HasMany
    {
        return $this->hasMany(EntityChange::class);
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }
}
