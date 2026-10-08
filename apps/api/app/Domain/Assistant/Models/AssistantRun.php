<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class AssistantRun extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['source_ids' => 'array', 'execution_context' => 'array', 'help_context' => 'array', 'help_sources' => 'array', 'help_answer' => 'array', 'decisions' => 'array', 'usage' => 'array', 'started_at' => 'datetime', 'finished_at' => 'datetime', 'cost_usd' => 'float', 'reserved_usd' => 'float'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AssistantConversation::class, 'conversation_id');
    }

    public function active(): bool
    {
        return in_array($this->status, ['queued', 'running'], true);
    }
}
