<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use App\Domain\Billing\Enums\InvoiceLineKind;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * One line of an invoice (spec 029 FR-032). `amount` is in minor units, negative for
 * credit; `unit_price` is null where a line has none (a prorated base price, credit).
 *
 * @property int $id
 * @property int $invoice_id
 * @property int $position
 * @property InvoiceLineKind $kind
 * @property string $description
 * @property string $quantity
 * @property int|null $unit_price
 * @property int $amount
 * @property CarbonImmutable|null $period_start
 * @property CarbonImmutable|null $period_end
 * @property int|null $plan_assignment_id
 * @property string|null $note
 * @property int|null $created_by
 */
final class InvoiceLine extends Model
{
    protected $table = 'billing_invoice_lines';

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'kind' => InvoiceLineKind::class,
            'quantity' => 'decimal:4',
            'unit_price' => 'integer',
            'amount' => 'integer',
            'period_start' => 'immutable_date',
            'period_end' => 'immutable_date',
        ];
    }
}
