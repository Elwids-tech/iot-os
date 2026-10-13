<?php

declare(strict_types=1);

namespace App\Domain\Agents\Models;

use App\Domain\Agents\Enums\ProposalKind;
use App\Domain\Agents\Enums\ProposalStatus;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A prepared change. Nothing changes until a person applies it in the portal. */
final class AgentProposal extends AgentModel
{
    protected function casts(): array
    {
        return [
            'kind' => ProposalKind::class,
            'status' => ProposalStatus::class,
            'base_revision' => 'integer',
            'payload' => 'array',
            'before' => 'array',
            'diagnostics' => 'array',
            'depends_on' => 'array',
            'result' => 'array',
            'applied_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(AgentProposalGroup::class, 'agent_proposal_group_id');
    }
}
