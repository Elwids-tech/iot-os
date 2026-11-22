<?php

declare(strict_types=1);

namespace App\Domain\Branding\Models;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Enums\PortalAddressState;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One host a billing account's portal is served on (spec 036, ADR-050).
 *
 * @property int $id
 * @property string $uuid
 * @property int|null $billing_account_id
 * @property PortalAddressKind $kind
 * @property string $host
 * @property PortalAddressState $state
 * @property string|null $claim_token
 * @property int $failed_checks
 * @property Carbon|null $last_reachable_at
 * @property int|null $claimed_by
 * @property int|null $suspended_by
 * @property Carbon|null $claimed_at
 * @property Carbon|null $activated_at
 * @property Carbon|null $last_checked_at
 * @property Carbon|null $unreachable_since
 * @property Carbon|null $suspended_at
 * @property Carbon|null $released_at
 * @property int|null $redirect_to_id
 * @property-read BillingAccount|null $billingAccount
 * @property-read PortalAddress|null $redirectTo
 */
final class PortalAddress extends Model
{
    use HasUuids;

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => PortalAddressKind::class,
            'state' => PortalAddressState::class,
            'claimed_at' => 'datetime',
            'activated_at' => 'datetime',
            'last_checked_at' => 'datetime',
            'last_reachable_at' => 'datetime',
            'unreachable_since' => 'datetime',
            'suspended_at' => 'datetime',
            'released_at' => 'datetime',
            'certificate_expires_at' => 'datetime',
            'certificate_checked_at' => 'datetime',
            'failed_checks' => 'integer',
        ];
    }

    /**
     * @return list<string>
     */
    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * @return BelongsTo<BillingAccount, $this>
     */
    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class);
    }

    /**
     * @return BelongsTo<PortalAddress, $this>
     */
    public function redirectTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'redirect_to_id');
    }

    /**
     * Whether the portal answers on this host now: the state serves and the account's
     * plan still allows it. A withdrawn allowance stops an address without changing its
     * state, so it returns when the allowance does (FR-037).
     */
    public function serves(): bool
    {
        $account = $this->billingAccount;
        if (! $this->state->serves() || $account === null) {
            return false;
        }
        $allowances = app(Allowances::class);

        return $allowances->allows($account, AllowanceKind::Branding)
            && ($this->kind !== PortalAddressKind::Domain || $allowances->allows($account, AllowanceKind::CustomDomain));
    }
}
