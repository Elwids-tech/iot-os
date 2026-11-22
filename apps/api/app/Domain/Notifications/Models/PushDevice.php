<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Models;

use App\Domain\Authentication\Models\KeptSignIn;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One browser where a person turned on push (spec 033, FR-020, FR-028). Its endpoint
 * and keys are secrets: encrypted at rest and never serialized. A device belongs to
 * one person; registering the same endpoint for someone else releases it first.
 *
 * @property int $id
 * @property string $uuid
 * @property int $user_id
 * @property string $endpoint
 * @property string $endpoint_hash
 * @property string $public_key
 * @property string $auth_token
 * @property string $content_encoding
 * @property string $label
 * @property int|null $kept_sign_in_id
 * @property int|null $portal_address_id
 * @property string|null $session_id
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $last_synced_at
 * @property CarbonImmutable|null $last_reached_at
 * @property CarbonImmutable|null $last_failed_at
 * @property string|null $last_failure
 */
final class PushDevice extends Model
{
    /** "At most 10 per person" (data-model.md). */
    public const LIMIT = 10;

    public const UPDATED_AT = null;

    protected $guarded = [];

    protected $hidden = ['endpoint', 'endpoint_hash', 'public_key', 'auth_token', 'session_id'];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'kept_sign_in_id' => 'integer',
            'portal_address_id' => 'integer',
            'endpoint' => 'encrypted',
            'public_key' => 'encrypted',
            'auth_token' => 'encrypted',
            'session_id' => 'encrypted',
            'created_at' => 'immutable_datetime',
            'last_synced_at' => 'immutable_datetime',
            'last_reached_at' => 'immutable_datetime',
            'last_failed_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        self::creating(function (self $device): void {
            $device->uuid ??= (string) Str::uuid();
        });
    }

    public static function hash(string $endpoint): string
    {
        return hash('sha256', $endpoint);
    }

    public static function forEndpoint(string $endpoint): ?self
    {
        return self::query()->where('endpoint_hash', self::hash($endpoint))->first();
    }

    /**
     * The devices an alert of this organization may be pushed to (spec 036, research
     * R12): those turned on at the platform's own address, and those at an address of
     * the organization's billing account. A tap opens on the address that subscribed,
     * and another account's address cannot open this organization.
     *
     * @param  Builder<self>  $query
     */
    public function scopeReaching(Builder $query, Organization $organization): void
    {
        $query->where(fn (Builder $devices) => $devices
            ->whereNull('portal_address_id')
            ->orWhereIn('portal_address_id', PortalAddress::query()->select('id')->where('billing_account_id', $organization->billing_account_id)));
    }

    /**
     * How many devices the person has push on at, other than at this address (null for
     * the platform's own), so the portal can say once that alerts must be turned on
     * again here (FR-032).
     */
    public static function elsewhere(User $user, ?PortalAddress $address): int
    {
        return self::query()->where('user_id', $user->getKey())
            ->when(
                $address === null,
                fn (Builder $devices) => $devices->whereNotNull('portal_address_id'),
                fn (Builder $devices) => $devices->where(fn (Builder $other) => $other->whereNull('portal_address_id')->orWhere('portal_address_id', '!=', $address->getKey())),
            )->count();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function keptSignIn(): BelongsTo
    {
        return $this->belongsTo(KeptSignIn::class);
    }

    /** What the device list shows; never the endpoint, keys or session. */
    public function toListItem(): array
    {
        return [
            'uuid' => $this->uuid,
            'label' => $this->label,
            'created_at' => $this->created_at->toIso8601ZuluString(),
            'last_reached_at' => $this->last_reached_at?->toIso8601ZuluString(),
            'last_failed_at' => $this->last_failed_at?->toIso8601ZuluString(),
        ];
    }
}
