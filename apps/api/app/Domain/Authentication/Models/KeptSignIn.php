<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Models;

use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One **Keep me signed in** sign-in on one browser or installed app (spec 033, FR-011a).
 * The browser holds `{uuid}.{secret}` in the `iot_kept` cookie; only the secret's
 * SHA-256 is stored. A record lasts 30 days from sign-in, is never extended, and once
 * ended never comes back.
 *
 * @property int $id
 * @property string $uuid
 * @property int $user_id
 * @property string $secret_hash
 * @property string $label
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $last_used_at
 * @property CarbonImmutable|null $ended_at
 * @property string|null $end_reason
 */
final class KeptSignIn extends Model
{
    public const DAYS = 30;

    public const SIGNED_OUT = 'signed_out';

    public const PASSWORD_RESET = 'password_reset';

    public const DEVICE_REMOVED = 'device_removed';

    public const UPDATED_AT = null;

    protected $guarded = [];

    protected $hidden = ['secret_hash'];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'created_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'last_used_at' => 'immutable_datetime',
            'ended_at' => 'immutable_datetime',
        ];
    }

    /**
     * Start a kept sign-in for this person on this browser.
     *
     * @return array{0: self, 1: string} the record and the plain secret, which only the cookie keeps
     */
    public static function issue(User $user, string $label): array
    {
        $secret = bin2hex(random_bytes(32));
        $now = now()->toImmutable();
        $record = self::query()->create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->getKey(),
            'secret_hash' => hash('sha256', $secret),
            'label' => Str::limit($label, 120, ''),
            'created_at' => $now,
            'expires_at' => $now->addDays(self::DAYS),
        ]);

        return [$record, $secret];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @param Builder<self> $query */
    public function scopeLive(Builder $query): void
    {
        $query->whereNull('ended_at')->where('expires_at', '>', now());
    }

    public function isLive(): bool
    {
        return $this->ended_at === null && $this->expires_at->isFuture();
    }

    public function matches(string $secret): bool
    {
        return hash_equals($this->secret_hash, hash('sha256', $secret));
    }

    /** End the record; a record that has already ended keeps its first reason. */
    public function end(string $reason): void
    {
        if ($this->ended_at !== null) {
            return;
        }
        $this->forceFill(['ended_at' => now(), 'end_reason' => $reason])->save();
    }

    /** Stamp `last_used_at`, at most once a minute. */
    public function touchUse(): void
    {
        if ($this->last_used_at === null || $this->last_used_at->lt(now()->subMinute())) {
            $this->forceFill(['last_used_at' => now()])->save();
        }
    }
}
