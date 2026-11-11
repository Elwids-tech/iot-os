<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models\Concerns;

use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Archiving for dashboards and automations (spec 031 FR-037): an archived item stays
 * readable, is hidden from lists unless they ask for it, and can be restored.
 */
trait Archivable
{
    /** The values lists take for `archived`: archived items alone, or with the others. */
    public const ARCHIVED_FILTERS = ['only', 'include'];

    public function initializeArchivable(): void
    {
        $this->mergeCasts(['archived_at' => 'datetime']);
    }

    public function archiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'archived_by');
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    /**
     * No filter hides archived items; `only` lists them alone and `include` with the others.
     *
     * @param  Builder<static>  $query
     */
    public function scopeArchiveFilter(Builder $query, ?string $filter): void
    {
        match ($filter) {
            'only' => $query->whereNotNull('archived_at'),
            'include' => null,
            default => $query->whereNull('archived_at'),
        };
    }

    /**
     * When the item was archived and by whom, for API responses.
     *
     * @return array{archived_at: Carbon|null, archived_by: array{user_id: int, name: string|null}|null}
     */
    public function archiveState(): array
    {
        return [
            'archived_at' => $this->archived_at,
            'archived_by' => $this->archived_at !== null && $this->archived_by !== null ? ['user_id' => $this->archived_by, 'name' => $this->archiver?->name] : null,
        ];
    }
}
