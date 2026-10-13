<?php

declare(strict_types=1);

namespace App\Domain\Agents\Console;

use App\Domain\Agents\Enums\ProposalStatus;
use App\Domain\Agents\Models\AgentActivity;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Agents\Models\AgentProposal;
use Illuminate\Console\Command;
use Laravel\Passport\Passport;

/**
 * Daily clean-up for agent access. Agents register a new Passport client for every
 * connection, so clients nobody connected are removed; activity and proposals age out.
 */
final class PruneAgents extends Command
{
    protected $signature = 'agents:prune';

    protected $description = 'Remove unused agent clients and old agent activity, and expire stale proposals';

    public function handle(): int
    {
        $clients = Passport::client()->newQuery()
            ->where('created_at', '<', now()->subHours((int) config('agents.unused_client_hours')))
            ->whereNotIn('id', AgentConnection::query()->select('oauth_client_id'))
            ->whereJsonContains('grant_types', 'authorization_code')
            ->delete();
        $activity = AgentActivity::query()->where('created_at', '<', now()->subDays((int) config('agents.activity_days')))->delete();
        $proposals = AgentProposal::query()->where('status', ProposalStatus::OPEN)->where('expires_at', '<', now())
            ->update(['status' => ProposalStatus::EXPIRED]);

        $this->info("Removed {$clients} unused agent clients and {$activity} activity records; expired {$proposals} proposals.");

        return self::SUCCESS;
    }
}
