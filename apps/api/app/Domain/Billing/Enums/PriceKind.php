<?php

declare(strict_types=1);

namespace App\Domain\Billing\Enums;

/**
 * What a plan charges (spec 029 FR-027), in minor units: a monthly base price, a price
 * per alert over the allowance, and a price per block of data points over it. A billing
 * account can override each from the next month (FR-028).
 */
enum PriceKind: string
{
    case BasePrice = 'base_price';
    case AlertOveragePrice = 'alert_overage_price';
    case DataPointOveragePrice = 'data_point_overage_price';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $kind): string => $kind->value, self::cases());
    }

    /** How the account history names the price. */
    public function label(): string
    {
        return match ($this) {
            self::BasePrice => 'base price',
            self::AlertOveragePrice => 'alert overage price',
            self::DataPointOveragePrice => 'data point overage price',
        };
    }
}
