<?php

declare(strict_types=1);

namespace App\Domain\Billing\Enums;

/**
 * An invoice line (spec 029 FR-032): a plan's base price for the days it applied, trial
 * days at 0, priced overage, an administrator's adjustment, or credit carried from a
 * credit note. Only adjustments survive a recalculation.
 */
enum InvoiceLineKind: string
{
    case BasePrice = 'base_price';
    case Trial = 'trial';
    case AlertOverage = 'alert_overage';
    case DataPointOverage = 'data_point_overage';
    case Adjustment = 'adjustment';
    case Credit = 'credit';
}
