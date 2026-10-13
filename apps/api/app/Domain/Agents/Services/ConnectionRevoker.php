<?php

declare(strict_types=1);

namespace App\Domain\Agents\Services;

use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Laravel\Passport\Passport;

/** Ends agent access when the person behind it loses theirs (FR-013). */
final class ConnectionRevoker
{
    /** A password reset ends every agent connection and token the person holds. */
    public function person(User $user, RevocationReason $reason): void
    {
        AgentConnection::query()->active()->where('user_id', $user->getKey())
            ->each(fn (AgentConnection $connection) => $connection->revoke($reason));
        $tokens = Passport::token()->newQuery()->where('user_id', $user->getKey());
        Passport::refreshToken()->newQuery()->whereIn('access_token_id', (clone $tokens)->select('id'))->update(['revoked' => true]);
        $tokens->update(['revoked' => true]);
    }

    /** Leaving an organization ends the person's connections to it. */
    public function member(User $user, Organization $organization, ?User $by = null): void
    {
        AgentConnection::query()->active()->where('user_id', $user->getKey())->where('organization_id', $organization->getKey())
            ->each(fn (AgentConnection $connection) => $connection->revoke(RevocationReason::MEMBERSHIP_REMOVED, $by));
    }
}
