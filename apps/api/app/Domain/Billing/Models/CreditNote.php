<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;
use LogicException;

/**
 * A credit note against an issued invoice (spec 029 FR-035, research R14), numbered in
 * its own unbroken sequence. `applied` is the part taken off what the invoice still
 * owed; the rest went to the account's credit for its next invoice. Never changes.
 *
 * @property int $id
 * @property string $uuid
 * @property int $invoice_id
 * @property string $number
 * @property int $amount
 * @property int $applied
 * @property string $reason
 * @property int|null $issued_by
 * @property CarbonImmutable $issued_at
 */
final class CreditNote extends Model
{
    protected $table = 'billing_credit_notes';

    public $timestamps = false;

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $note): void {
            $note->uuid ??= (string) Str::uuid();
        });
        self::updating(static function (): void {
            throw new LogicException('A credit note cannot change.');
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    protected function casts(): array
    {
        return ['amount' => 'integer', 'applied' => 'integer', 'issued_at' => 'immutable_datetime'];
    }

    /**
     * @return BelongsTo<Invoice, $this>
     */
    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }
}
