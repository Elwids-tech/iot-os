<?php

declare(strict_types=1);

namespace App\Domain\Entities\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One structural change to an entity, for history and "as of" questions (spec 009,
 * FR-012, research R12): created, moved, renamed, retyped, archived or restored.
 */
final class EntityChange extends Model
{
    public const CREATED = 'created';

    public const MOVED = 'moved';

    public const RENAMED = 'renamed';

    public const RETYPED = 'retyped';

    public const ARCHIVED = 'archived';

    public const RESTORED = 'restored';

    public $timestamps = false;

    protected $table = 'entity_changes';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['changed_at' => 'datetime'];
    }

    public function entity(): BelongsTo
    {
        return $this->belongsTo(Entity::class);
    }
}
