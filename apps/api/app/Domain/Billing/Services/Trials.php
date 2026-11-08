<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Models\BillingAccount;

/**
 * Trials (spec 029 US8). A card saved on an account whose limited trial ended without
 * one starts the paid plan from the next 00:00 UTC; trials arrive in PR 13, so until
 * then a saved card changes nothing here.
 */
final class Trials
{
    public function paymentMethodSaved(BillingAccount $account): void {}
}
