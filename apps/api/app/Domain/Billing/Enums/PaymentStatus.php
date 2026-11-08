<?php

declare(strict_types=1);

namespace App\Domain\Billing\Enums;

/**
 * Whether an issued invoice is settled (spec 029 US6 and US7): `credited` when credit
 * notes left nothing to pay, `paid_outside` when an administrator recorded a payment made
 * another way. The only thing that changes on an issued invoice.
 */
enum PaymentStatus: string
{
    case Pending = 'pending';
    case Paid = 'paid';
    case Failed = 'failed';
    case Credited = 'credited';
    case PaidOutside = 'paid_outside';
}
