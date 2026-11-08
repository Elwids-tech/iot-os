<?php

declare(strict_types=1);

namespace App\Domain\Billing\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * A named tax rate in basis points (spec 029 FR-029). Archived rates stay on the accounts
 * that have them and cannot be newly chosen; an invoice snapshots the name and rate when
 * issued. Written only by `TaxRates`.
 *
 * @property string $uuid
 * @property string $name
 * @property int $basis_points
 * @property CarbonImmutable|null $archived_at
 */
final class TaxRate extends Model
{
    protected $table = 'billing_tax_rates';

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $rate): void {
            $rate->uuid ??= (string) Str::uuid();
        });
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    protected function casts(): array
    {
        return ['basis_points' => 'integer', 'archived_at' => 'immutable_datetime'];
    }
}
