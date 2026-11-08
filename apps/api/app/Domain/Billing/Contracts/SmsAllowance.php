<?php

declare(strict_types=1);

namespace App\Domain\Billing\Contracts;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;

/**
 * Where spec 011's SMS sender asks for room in the billing account's SMS allowance
 * (spec 028 FR-013, FR-016, FR-025). It reserves a message's parts before handing it to
 * the provider and releases them if the provider refuses it before accepting. Verification
 * codes never come here. Bound to `Usage`.
 */
interface SmsAllowance
{
    /**
     * Counts `$parts` in the month of `$at` when they fit in what is left, under the
     * account's row lock, and answers false otherwise: the message is then cancelled with
     * "SMS allowance used up for this month". SMS never records overage.
     */
    public function reserve(BillingAccount $account, Organization $organization, int $parts, CarbonImmutable $at): bool;

    /**
     * Gives back parts reserved at `$reservedAt` for a message the provider refused before
     * accepting it. The count never goes below 0.
     */
    public function release(BillingAccount $account, Organization $organization, int $parts, CarbonImmutable $reservedAt): void;
}
