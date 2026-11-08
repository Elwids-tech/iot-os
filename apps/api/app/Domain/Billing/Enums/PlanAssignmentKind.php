<?php

declare(strict_types=1);

namespace App\Domain\Billing\Enums;

/**
 * How a billing account is on its plan (ADR-035). Only `paid` days are charged.
 * `trial_unpaid` is a limited trial that ended without a saved card: still on the
 * plan, not charged, flagged for an administrator (spec 029 US8).
 */
enum PlanAssignmentKind: string
{
    case Paid = 'paid';
    case Trial = 'trial';
    case TrialUnpaid = 'trial_unpaid';
}
