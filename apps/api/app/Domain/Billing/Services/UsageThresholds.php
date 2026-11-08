<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Mail\UsageThresholdMail;
use App\Domain\Billing\Models\BillingAccount;

/**
 * Warns a billing account's owners when a limited allowance passes 80% and again when it
 * is used up (spec 028 FR-023, spec 029 FR-025): once per threshold, allowance and month,
 * through the notices ledger. Unlimited allowances send nothing.
 */
final class UsageThresholds
{
    /** @var list<int> */
    public const PERCENTS = [80, 100];

    public function __construct(private readonly Notices $notices) {}

    /**
     * Called after a count changes, with the month's total and the allowance it was
     * counted against.
     */
    public function check(BillingAccount $account, AllowanceKind $kind, string $month, int $count, ?int $allowance): void
    {
        if ($allowance === null) {
            return;
        }

        foreach (self::PERCENTS as $percent) {
            // count >= ceil(allowance × percent / 100), in whole numbers.
            if ($count * 100 < $percent * $allowance) {
                continue;
            }

            $this->notices->send(
                $account,
                'usage_threshold',
                sprintf('%s:%s:%d', $kind->value, substr($month, 0, 7), $percent),
                new UsageThresholdMail((string) $account->uuid, (string) $account->name, $kind->value, $month, $percent, $count, $allowance),
            );
        }
    }
}
