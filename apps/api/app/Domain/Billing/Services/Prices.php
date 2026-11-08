<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\PriceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Plan prices and account price overrides (spec 029 FR-027, FR-028, research R12). Every
 * change applies from the first day of the next UTC month, writing that month's row or
 * replacing one already waiting, so a month is always priced from one set of prices.
 * Month M uses the latest row with `effective_from ≤ M`; a plan with none is free, and a
 * removed override (a null value) falls back to the plan.
 */
final class Prices
{
    public const DEFAULT_BLOCK_SIZE = 1_000_000;

    /** The first day of the UTC month after `$at`. */
    public static function nextMonth(CarbonImmutable $at): CarbonImmutable
    {
        return $at->utc()->startOfMonth()->addMonthNoOverflow();
    }

    /**
     * @param  array{base_price: int, alert_overage_price: int, data_point_overage_price: int, data_point_block_size: int}  $values
     */
    public function setPlanPrices(BillingPlan $plan, array $values, User $actor): CarbonImmutable
    {
        $from = self::nextMonth(CarbonImmutable::now());

        DB::transaction(function () use ($plan, $values, $actor, $from): void {
            $before = $this->planPrices($plan, $from);
            DB::table('billing_plan_prices')->upsert([[
                'billing_plan_id' => $plan->getKey(),
                'effective_from' => $from->toDateString(),
                ...$values,
                'set_by' => $actor->getKey(),
                'created_at' => now(),
            ]], ['billing_plan_id', 'effective_from'], [...array_keys($values), 'set_by', 'created_at']);
            ActivityLog::record('billing_plan.prices_set', null, $actor, $plan, [
                'effective_from' => $from->toDateString(),
                'from' => $before,
                'to' => $values,
            ]);
        });

        return $from;
    }

    /** Overrides one price for one account from next month; null removes the override. */
    public function override(BillingAccount $account, PriceKind $price, ?int $value, ?string $note, User $actor): CarbonImmutable
    {
        $from = self::nextMonth(CarbonImmutable::now());

        DB::transaction(function () use ($account, $price, $value, $note, $actor, $from): void {
            $before = $this->overrides($account, $from)[$price->value] ?? null;
            DB::table('billing_price_overrides')->upsert([[
                'billing_account_id' => $account->getKey(),
                'price' => $price->value,
                'effective_from' => $from->toDateString(),
                'value' => $value,
                'note' => $note,
                'set_by' => $actor->getKey(),
                'created_at' => now(),
            ]], ['billing_account_id', 'price', 'effective_from'], ['value', 'note', 'set_by', 'created_at']);
            ActivityLog::record('billing_account.price_overridden', null, $actor, $account, [
                'price' => $price->value,
                'from' => $before,
                'to' => $value,
                'effective_from' => $from->toDateString(),
                'note' => $note,
            ]);
        });

        return $from;
    }

    /**
     * A plan's prices in force in a month; a plan with no prices yet, or no plan, is free.
     *
     * @return array{base_price: int, alert_overage_price: int, data_point_overage_price: int, data_point_block_size: int}
     */
    public function planPrices(BillingPlan|int|null $plan, CarbonImmutable $month): array
    {
        $row = $plan === null ? null : DB::table('billing_plan_prices')
            ->where('billing_plan_id', $plan instanceof BillingPlan ? $plan->getKey() : $plan)
            ->where('effective_from', '<=', $month->toDateString())
            ->orderByDesc('effective_from')
            ->first();

        return [
            'base_price' => (int) ($row->base_price ?? 0),
            'alert_overage_price' => (int) ($row->alert_overage_price ?? 0),
            'data_point_overage_price' => (int) ($row->data_point_overage_price ?? 0),
            'data_point_block_size' => (int) ($row->data_point_block_size ?? self::DEFAULT_BLOCK_SIZE),
        ];
    }

    /**
     * The account's overrides in force in a month, by price; a removed one is absent.
     *
     * @return array<string, int>
     */
    public function overrides(BillingAccount $account, CarbonImmutable $month): array
    {
        $in = [];
        foreach (PriceKind::values() as $price) {
            $value = $this->overrideRow($account, $price, $month)?->value;
            if ($value !== null) {
                $in[$price] = (int) $value;
            }
        }

        return $in;
    }

    /**
     * What an account pays on a plan in a month: the plan's prices with its overrides.
     *
     * @return array{base_price: int, alert_overage_price: int, data_point_overage_price: int, data_point_block_size: int}
     */
    public function for(BillingAccount $account, BillingPlan|int|null $plan, CarbonImmutable $month): array
    {
        return [...$this->planPrices($plan, $month), ...$this->overrides($account, $month)];
    }

    /**
     * Each overridden price, for administrators: the override this month and the one next
     * month, which differ while a change waits. Null is no override (the plan's price).
     *
     * @return list<array{price: string, value: ?int, note: ?string, next_value: ?int, next_note: ?string}>
     */
    public function overrideList(BillingAccount $account, CarbonImmutable $now): array
    {
        $list = [];
        foreach (PriceKind::values() as $price) {
            $current = $this->overrideRow($account, $price, $now->utc()->startOfMonth());
            $next = $this->overrideRow($account, $price, self::nextMonth($now));
            if ($current?->value === null && $next?->value === null) {
                continue;
            }
            $list[] = [
                'price' => $price,
                'value' => $current?->value === null ? null : (int) $current->value,
                'note' => $current?->value === null ? null : $current->note,
                'next_value' => $next?->value === null ? null : (int) $next->value,
                'next_note' => $next?->value === null ? null : $next->note,
            ];
        }

        return $list;
    }

    private function overrideRow(BillingAccount $account, string $price, CarbonImmutable $month): ?object
    {
        return DB::table('billing_price_overrides')
            ->where('billing_account_id', $account->getKey())
            ->where('price', $price)
            ->where('effective_from', '<=', $month->toDateString())
            ->orderByDesc('effective_from')
            ->first();
    }
}
