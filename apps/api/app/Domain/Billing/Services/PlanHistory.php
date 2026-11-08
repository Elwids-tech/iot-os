<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Enums\PriceKind;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Support\Money;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * A plan's latest history (spec 028 FR-006): its audited changes, newest first.
 * Allowance values read as text: a number, "Unlimited" or "Default".
 */
final class PlanHistory
{
    private const LIMIT = 100;

    private const ACTIONS = [
        'billing_plan.created' => 'created',
        'billing_plan.updated' => 'updated',
        'billing_plan.archived' => 'archived',
        'billing_plan.restored' => 'restored',
        'billing_plan.prices_set' => 'updated',
    ];

    /**
     * @return list<BillingAccountHistoryEntry>
     */
    public function for(BillingPlan $plan): array
    {
        $events = DB::table('activity_log')
            ->where('subject_uuid', $plan->uuid)
            ->whereIn('event', array_keys(self::ACTIONS))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::LIMIT)
            ->get(['event', 'causer_id', 'properties', 'created_at']);

        $actors = User::query()
            ->whereIn('id', $events->pluck('causer_id')->filter()->unique()->values())
            ->get(['id', 'name'])
            ->keyBy('id');

        return $events
            ->map(function (object $event) use ($actors): BillingAccountHistoryEntry {
                $details = json_decode((string) $event->properties, true) ?: [];
                $actor = $event->causer_id === null ? null : $actors->get((int) $event->causer_id);

                return new BillingAccountHistoryEntry(
                    CarbonImmutable::parse($event->created_at),
                    self::ACTIONS[$event->event],
                    $actor === null ? null : ['id' => (int) $actor->id, 'name' => (string) $actor->name],
                    changes: $this->changes($details),
                );
            })
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $details
     * @return list<BillingAccountChange>
     */
    private function changes(array $details): array
    {
        $list = [];

        foreach ($details['changes'] ?? [] as $field => $change) {
            $list[] = new BillingAccountChange((string) $field, BillingAccountChange::text($change['from'] ?? null), BillingAccountChange::text($change['to'] ?? null));
        }

        // Prices set for next month (spec 029 FR-028): each price that changes, and from when.
        if (isset($details['effective_from']) && is_array($details['from'] ?? null) && is_array($details['to'] ?? null)) {
            $from = CarbonImmutable::parse((string) $details['effective_from'])->format('j M Y');
            foreach ([...PriceKind::values(), 'data_point_block_size'] as $field) {
                $before = (int) ($details['from'][$field] ?? 0);
                $after = (int) ($details['to'][$field] ?? 0);
                if ($before !== $after) {
                    $text = $field === 'data_point_block_size' ? number_format(...) : Money::format(...);
                    $list[] = new BillingAccountChange($field, $text($before), $text($after).' from '.$from);
                }
            }
        }

        // PostgreSQL's jsonb reorders object keys, so allowances are listed in the enum's order.
        $allowances = $details['allowances'] ?? [];

        foreach (AllowanceKind::values() as $kind) {
            if (! array_key_exists($kind, $allowances)) {
                continue;
            }

            $change = $allowances[$kind];
            // Created events list the plan's values; updated events list from and to.
            // A null value is unlimited, so look for the key rather than coalescing.
            [$from, $to] = is_array($change)
                ? [array_key_exists('from', $change) ? $change['from'] : 'default', array_key_exists('to', $change) ? $change['to'] : 'default']
                : ['default', $change];
            $list[] = new BillingAccountChange((string) $kind, self::allowance($from), self::allowance($to));
        }

        return $list;
    }

    private static function allowance(mixed $value): string
    {
        return match (true) {
            $value === 'default' => 'Default',
            $value === null => 'Unlimited',
            default => number_format((int) $value),
        };
    }
}
