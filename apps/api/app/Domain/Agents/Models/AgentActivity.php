<?php

declare(strict_types=1);

namespace App\Domain\Agents\Models;

use App\Domain\Agents\Enums\ActivityOutcome;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One tool call made through a connection. Arguments and results are never stored. */
final class AgentActivity extends AgentModel
{
    protected $table = 'agent_activity';

    public $timestamps = false;

    protected function usesUuid(): bool
    {
        return false;
    }

    protected function casts(): array
    {
        return ['targets' => 'array', 'outcome' => ActivityOutcome::class, 'duration_ms' => 'integer', 'created_at' => 'immutable_datetime'];
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(AgentConnection::class, 'agent_connection_id');
    }
}
