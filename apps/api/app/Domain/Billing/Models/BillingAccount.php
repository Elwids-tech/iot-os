<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Database\Factories\BillingAccountFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;
use Laravel\Cashier\Billable;

/**
 * The payer of record for one or more organizations (spec 023, ADR-026). It groups
 * organizations for billing and grants no access to them. Its limits come from its
 * plan and overrides (ADR-035), resolved by `Allowances`. Its billing details (address,
 * tax number, tax rate) go on its invoices (spec 029 FR-029); only `BillingDetails`
 * writes them. It is a Stripe customer through Cashier (spec 029 US7, ADR-037) and keeps
 * only its card's brand, last four digits and expiry; `Payments` writes those.
 *
 * @property string|null $stripe_id
 * @property string|null $pm_type
 * @property string|null $pm_last_four
 * @property string|null $pm_expires
 * @property CarbonImmutable|null $past_due_since
 */
#[Fillable(['name', 'contact_email', 'notes'])]
final class BillingAccount extends Model
{
    use Billable;

    /** @use HasFactory<BillingAccountFactory> */
    use HasFactory, SoftDeletes;

    protected static function booted(): void
    {
        self::creating(static function (self $account): void {
            $account->uuid ??= (string) Str::uuid();
        });
    }

    protected static function newFactory(): BillingAccountFactory
    {
        return BillingAccountFactory::new();
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    protected function casts(): array
    {
        return [
            'past_due_since' => 'immutable_datetime',
        ];
    }

    /** The name Stripe shows for the customer. */
    public function stripeName(): ?string
    {
        return $this->name;
    }

    /** Stripe's receipts and Checkout prefill go to the billing contact, if there is one. */
    public function stripeEmail(): ?string
    {
        return $this->contact_email;
    }

    /**
     * The saved card as shown to owners and administrators, or null: never more than
     * the brand, last four digits and expiry (spec 029 FR-039).
     *
     * @return array{brand: string, last_four: string|null, expires: string|null}|null
     */
    public function paymentMethodSummary(): ?array
    {
        return $this->pm_type === null ? null : [
            'brand' => (string) $this->pm_type,
            'last_four' => $this->pm_last_four,
            'expires' => $this->pm_expires,
        ];
    }

    /**
     * People a platform administrator allowed to see the account and create
     * organizations under it. The pivot has `created_at` but no `updated_at`.
     *
     * @return BelongsToMany<User, $this>
     */
    public function owners(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'billing_account_owners')
            ->withPivot(['added_by', 'created_at']);
    }

    /**
     * @return HasMany<Organization, $this>
     */
    public function organizations(): HasMany
    {
        return $this->hasMany(Organization::class);
    }

    /**
     * @return HasMany<BillingAccountAssignment, $this>
     */
    public function assignments(): HasMany
    {
        return $this->hasMany(BillingAccountAssignment::class);
    }

    /**
     * @return BelongsTo<TaxRate, $this>
     */
    public function taxRate(): BelongsTo
    {
        return $this->belongsTo(TaxRate::class, 'billing_tax_rate_id');
    }

    /**
     * @return HasMany<Invoice, $this>
     */
    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    /**
     * @return HasMany<PlanAssignment, $this>
     */
    public function planAssignments(): HasMany
    {
        return $this->hasMany(PlanAssignment::class);
    }

    /**
     * The plan the account is on now, if any.
     *
     * @return HasOne<PlanAssignment, $this>
     */
    public function openPlanAssignment(): HasOne
    {
        return $this->hasOne(PlanAssignment::class)->whereNull('ended_at');
    }

    /**
     * @return HasMany<AllowanceOverride, $this>
     */
    public function allowanceOverrides(): HasMany
    {
        return $this->hasMany(AllowanceOverride::class);
    }
}
