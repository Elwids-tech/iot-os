<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Models;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One attempt to sign up (spec 035, data-model.md). Until its email is confirmed it is
 * the only thing that exists; completing it creates the person, their billing account
 * and their organization (research R5). Only `SignUps` writes it.
 *
 * @property int $id
 * @property string $uuid
 * @property string $name
 * @property string $email
 * @property string $organization_name
 * @property string|null $password
 * @property string $state
 * @property string|null $refusal_reason
 * @property string|null $token_hash
 * @property CarbonImmutable|null $token_expires_at
 * @property int $sends
 * @property CarbonImmutable|null $last_sent_at
 * @property string|null $ip_address
 * @property string|null $user_agent
 * @property CarbonImmutable|null $confirmed_at
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $signed_in_at
 * @property int|null $user_id
 * @property int|null $organization_id
 * @property int|null $billing_account_id
 * @property CarbonImmutable $created_at
 */
final class SignUp extends Model
{
    public const WAITING = 'waiting';

    public const COMPLETED = 'completed';

    public const REFUSED = 'refused';

    /** Shown in the admin list for a waiting sign-up whose link ran out; never stored. */
    public const EXPIRED = 'expired';

    protected $guarded = ['id'];

    protected $hidden = ['password', 'token_hash'];

    protected function casts(): array
    {
        return [
            'token_expires_at' => 'immutable_datetime',
            'last_sent_at' => 'immutable_datetime',
            'confirmed_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'signed_in_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'sends' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        self::creating(static function (self $signUp): void {
            $signUp->uuid ??= (string) Str::uuid();
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function isWaiting(): bool
    {
        return $this->state === self::WAITING;
    }

    public function linkExpired(): bool
    {
        return $this->token_expires_at === null || $this->token_expires_at->isPast();
    }

    /** The state the admin list shows: a waiting sign-up whose link ran out is expired. */
    public function displayState(): string
    {
        return $this->isWaiting() && $this->linkExpired() ? self::EXPIRED : $this->state;
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Organization, $this> */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** @return BelongsTo<BillingAccount, $this> */
    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class);
    }
}
