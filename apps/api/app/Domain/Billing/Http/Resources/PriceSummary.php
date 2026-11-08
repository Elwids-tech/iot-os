<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Services\Prices;
use Carbon\CarbonImmutable;

/**
 * Prices as the API sends them (spec 029 FR-027, FR-030): this month's, and next month's
 * when a change waits (`next` is null otherwise). Amounts are integers in the minor units
 * of `currency`.
 */
final class PriceSummary
{
    /**
     * @return array{currency: string, current: array<string, int|string>, next: array<string, int|string>|null}
     */
    public static function forPlan(BillingPlan $plan): array
    {
        return self::summary(fn (CarbonImmutable $month): array => app(Prices::class)->planPrices($plan, $month));
    }

    /**
     * What an account pays on its current plan, overrides included; null without a plan.
     *
     * @return array{currency: string, current: array<string, int|string>, next: array<string, int|string>|null}|null
     */
    public static function forAccount(BillingAccount $account): ?array
    {
        $plan = $account->openPlanAssignment?->billing_plan_id;

        return $plan === null ? null : self::summary(fn (CarbonImmutable $month): array => app(Prices::class)->for($account, $plan, $month));
    }

    /**
     * @param  callable(CarbonImmutable): array{base_price: int, alert_overage_price: int, data_point_overage_price: int, data_point_block_size: int}  $at
     * @return array{currency: string, current: array<string, int|string>, next: array<string, int|string>|null}
     */
    private static function summary(callable $at): array
    {
        $month = CarbonImmutable::now()->utc()->startOfMonth();
        $next = Prices::nextMonth($month);
        $current = $at($month);
        $later = $at($next);

        return [
            'currency' => (string) config('billing.currency'),
            'current' => ['effective_from' => $month->toDateString(), ...$current],
            'next' => $later === $current ? null : ['effective_from' => $next->toDateString(), ...$later],
        ];
    }
}
