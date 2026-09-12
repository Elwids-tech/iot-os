<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class AssistantProposal extends Model
{
    use HasUuids;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['changes' => 'array', 'before' => 'array', 'evidence' => 'array', 'diagnostics' => 'array', 'result' => 'array'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AssistantConversation::class, 'conversation_id');
    }
}
