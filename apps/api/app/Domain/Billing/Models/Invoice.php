<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use App\Domain\Billing\Enums\PaymentStatus;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;
use LogicException;

/**
 * A billing account's invoice for one UTC month (spec 029 US6, research R13). A draft is
 * recalculated and adjusted until an administrator issues it; then it never changes
 * except `payment_status`, and corrections are credit notes. What is still owed is
 * `amount_due` less the credit notes' applied parts and the payments that succeeded
 * (`outstanding()`).
 *
 * @property int $id
 * @property string $uuid
 * @property int $billing_account_id
 * @property CarbonImmutable $month
 * @property string $status
 * @property string|null $number
 * @property bool $usage_incomplete
 * @property string|null $draft_note
 * @property string $currency
 * @property array<string, mixed>|null $operator_details
 * @property array<string, mixed>|null $account_details
 * @property string|null $tax_rate_name
 * @property int|null $tax_basis_points
 * @property int $subtotal
 * @property int $tax
 * @property int $total
 * @property int $credit_applied
 * @property int $amount_due
 * @property CarbonImmutable|null $due_at
 * @property PaymentStatus $payment_status
 * @property int|null $drafted_by
 * @property CarbonImmutable $drafted_at
 * @property int|null $issued_by
 * @property CarbonImmutable|null $issued_at
 */
final class Invoice extends Model
{
    public const DRAFT = 'draft';

    public const ISSUED = 'issued';

    protected $table = 'billing_invoices';

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $invoice): void {
            $invoice->uuid ??= (string) Str::uuid();
        });
        // Issued invoices are fixed for good (spec 029 D7, FR-034).
        self::updating(static function (self $invoice): void {
            if ($invoice->getOriginal('status') === self::ISSUED && array_diff(array_keys($invoice->getDirty()), ['payment_status', 'updated_at']) !== []) {
                throw new LogicException('An issued invoice cannot change.');
            }
        });
        self::deleting(static function (self $invoice): void {
            if ($invoice->getOriginal('status') === self::ISSUED) {
                throw new LogicException('An issued invoice cannot be deleted.');
            }
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    protected function casts(): array
    {
        return [
            'month' => 'immutable_date',
            'usage_incomplete' => 'boolean',
            'operator_details' => 'array',
            'account_details' => 'array',
            'tax_basis_points' => 'integer',
            'subtotal' => 'integer',
            'tax' => 'integer',
            'total' => 'integer',
            'credit_applied' => 'integer',
            'amount_due' => 'integer',
            'due_at' => 'immutable_datetime',
            'payment_status' => PaymentStatus::class,
            'drafted_at' => 'immutable_datetime',
            'issued_at' => 'immutable_datetime',
        ];
    }

    public function isIssued(): bool
    {
        return $this->status === self::ISSUED;
    }

    /**
     * What is still owed: nothing once paid, else the amount due less what credit notes
     * took off it and what was paid towards it.
     */
    public function outstanding(): int
    {
        if (in_array($this->payment_status, [PaymentStatus::Paid, PaymentStatus::PaidOutside], true)) {
            return 0;
        }

        return max(0, $this->amount_due - (int) $this->creditNotes()->sum('applied') - $this->paid());
    }

    /** The payments towards it that succeeded (spec 029 US7). */
    public function paid(): int
    {
        return (int) $this->payments()->where('status', Payment::SUCCEEDED)->sum('amount');
    }

    /**
     * @return BelongsTo<BillingAccount, $this>
     */
    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class)->withTrashed();
    }

    /**
     * @return HasMany<InvoiceLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(InvoiceLine::class)->orderBy('position');
    }

    /**
     * @return HasMany<CreditNote, $this>
     */
    public function creditNotes(): HasMany
    {
        return $this->hasMany(CreditNote::class)->orderBy('issued_at')->orderBy('id');
    }

    /**
     * @return HasMany<Payment, $this>
     */
    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class)->orderBy('created_at')->orderBy('id');
    }
}
