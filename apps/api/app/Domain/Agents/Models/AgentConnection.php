<?php

declare(strict_types=1);

namespace App\Domain\Agents\Models;

use App\Domain\Agents\Enums\AccessLevel;
use App\Domain\Agents\Enums\RevocationReason;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;
use Laravel\Passport\Client;
use Laravel\Passport\Passport;

/**
 * One person's agent (a Passport client) acting in one organization at one access
 * level. Passport issues the tokens; this row decides whether they may be used.
 */
final class AgentConnection extends AgentModel
{
    protected function casts(): array
    {
        return [
            'access_level' => AccessLevel::class,
            'revoked_reason' => RevocationReason::class,
            'last_used_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Passport::clientModel(), 'oauth_client_id');
    }

    public function activity(): HasMany
    {
        return $this->hasMany(AgentActivity::class);
    }

    /** @param Builder<self> $query */
    public function scopeActive(Builder $query): void
    {
        $query->whereNull('revoked_at');
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    /** Push expiry out to the idle window from now; called when the connection is used. */
    public function touchUse(): void
    {
        $now = now()->toImmutable();
        $this->forceFill([
            'last_used_at' => $now,
            'expires_at' => $now->addDays((int) config('agents.connection_idle_days')),
        ])->save();
    }

    /** Revoke the connection and every Passport token its client holds for this person. */
    public function revoke(RevocationReason $reason, ?User $by = null): void
    {
        DB::transaction(function () use ($reason, $by): void {
            if ($this->revoked_at === null) {
                $this->forceFill([
                    'revoked_at' => now(),
                    'revoked_reason' => $reason,
                    'revoked_by_user_id' => $by?->getKey(),
                ])->save();
            }
            self::revokeTokens($this->user_id, (string) $this->oauth_client_id);
        });
    }

    public static function revokeTokens(int $userId, string $clientId): void
    {
        $tokens = Passport::token()->newQuery()->where('user_id', $userId)->where('client_id', $clientId);
        Passport::refreshToken()->newQuery()->whereIn('access_token_id', (clone $tokens)->select('id'))->update(['revoked' => true]);
        $tokens->update(['revoked' => true]);
    }

    public function clientName(): string
    {
        $client = $this->client;

        return $client instanceof Client ? (string) $client->name : 'Unknown agent';
    }
}
