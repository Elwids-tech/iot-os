<?php

declare(strict_types=1);

namespace App\Domain\Entities\Models;

use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What kind of entity something is, and the rules that hold the tree to a standard:
 * where it may sit, what it may hold as members, whether devices may be placed on it,
 * whether it carries a time zone and a location, and a naming template (spec 009, FR-006).
 *
 * @property list<string> $parent_type_keys
 * @property list<string> $member_type_keys
 * @property list<string> $preset_keys
 */
final class EntityType extends EntityModel
{
    /** The reserved key of the type whose entities are the organization's sites (research R4). */
    public const SITE = 'site';

    protected $table = 'entity_types';

    protected function casts(): array
    {
        return [
            'top_level' => 'boolean',
            'accepts_devices' => 'boolean',
            'carries_timezone' => 'boolean',
            'carries_location' => 'boolean',
            'parent_type_keys' => 'array',
            'member_type_keys' => 'array',
            'preset_keys' => 'array',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function entities(): HasMany
    {
        return $this->hasMany(Entity::class);
    }

    public function isSite(): bool
    {
        return $this->key === self::SITE;
    }

    /** Whether an entity of this type may sit under a parent of the given type (null: the top level). */
    public function allowsParent(?self $parent): bool
    {
        return $parent === null ? $this->top_level : in_array($parent->key, $this->parent_type_keys ?? [], true);
    }
}
