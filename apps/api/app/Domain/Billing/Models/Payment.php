<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One payment towards an issued invoice (spec 029 US7): an off-session card charge, a
 * Stripe Checkout payment, or one an administrator recorded as made another way. Its
 * status only moves forward: pending to failed or succeeded, and failed to succeeded.
 *
 * @property int $id
 * @property string $uuid
 * @property int $invoice_id
 * @property int $amount
 * @property string $method
 * @property string|null $provider_reference
 * @property int $attempt
 * @property string $status
 * @property string|null $failure_reason
 * @property string|null $note
 * @property int|null $recorded_by
 * @property CarbonImmutable $status_at
 * @property CarbonImmutable $created_at
 */
final class Payment extends Model
{
    public const CARD = 'card';

    public const CHECKOUT = 'checkout';

    public const OUTSIDE = 'outside';

    public const PENDING = 'pending';

    public const SUCCEEDED = 'succeeded';

    public const FAILED = 'failed';

    protected $table = 'billing_payments';

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $payment): void {
            $payment->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'attempt' => 'integer',
            'status_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    /** Whether `status` may follow this payment's status. */
    public function canMoveTo(string $status): bool
    {
        return match ($this->status) {
            self::PENDING => $status !== self::PENDING,
            self::FAILED => $status === self::SUCCEEDED,
            default => false,
        };
    }

    /**
     * @return BelongsTo<Invoice, $this>
     */
    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }
}
