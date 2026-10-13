<?php

declare(strict_types=1);

namespace App\Domain\Agents\Models;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** The proposals an agent prepared for one task, reviewed from one portal link. */
final class AgentProposalGroup extends AgentModel
{
    public function connection(): BelongsTo
    {
        return $this->belongsTo(AgentConnection::class, 'agent_connection_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function proposals(): HasMany
    {
        return $this->hasMany(AgentProposal::class);
    }
}
