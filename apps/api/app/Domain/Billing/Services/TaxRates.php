<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Models\TaxRate;
use App\Domain\Shared\Models\User;

/**
 * Named tax rates in basis points (spec 029 FR-029). A rate is archived, never deleted:
 * accounts keep an archived rate, and issued invoices hold their own copy of it.
 */
final class TaxRates
{
    public function create(string $name, int $basisPoints, User $actor): TaxRate
    {
        $rate = TaxRate::query()->create(['name' => $name, 'basis_points' => $basisPoints]);
        ActivityLog::record('billing_tax_rate.created', null, $actor, $rate, ['name' => $name, 'basis_points' => $basisPoints]);

        return $rate;
    }

    /**
     * @param  array{name?: string, basis_points?: int}  $values
     */
    public function update(TaxRate $rate, array $values, User $actor): TaxRate
    {
        $before = ['name' => $rate->name, 'basis_points' => $rate->basis_points];
        $rate->fill($values)->save();
        ActivityLog::record('billing_tax_rate.updated', null, $actor, $rate, ['from' => $before, 'to' => ['name' => $rate->name, 'basis_points' => $rate->basis_points]]);

        return $rate;
    }

    public function archive(TaxRate $rate, User $actor): TaxRate
    {
        if ($rate->archived_at === null) {
            $rate->forceFill(['archived_at' => now()])->save();
            ActivityLog::record('billing_tax_rate.archived', null, $actor, $rate, ['name' => $rate->name]);
        }

        return $rate;
    }
}
