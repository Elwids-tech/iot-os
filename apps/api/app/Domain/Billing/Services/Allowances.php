<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\AllowanceOverride;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\PlanAllowance;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * What a billing account may use (spec 028 FR-009, spec 029 FR-003, ADR-035): its
 * override, else its plan's allowance, else the deployment's default. `null` is
 * unlimited, except for retention, where it means the platform setting applies.
 */
final class Allowances
{
    public function resolve(BillingAccount $account, AllowanceKind $kind): ResolvedAllowance
    {
        return $this->all($account)[$kind->value];
    }

    public function value(BillingAccount $account, AllowanceKind $kind): ?int
    {
        return $this->resolve($account, $kind)->value;
    }

    /**
     * Every kind, in the enum's order. Loaded `allowanceOverrides` and
     * `openPlanAssignment.plan.allowances` relations are used when present, so a list
     * can eager-load them; otherwise it is one query for overrides and two for the plan.
     *
     * @return array<string, ResolvedAllowance>
     */
    public function all(BillingAccount $account): array
    {
        $overrides = ($account->relationLoaded('allowanceOverrides')
            ? $account->allowanceOverrides
            : AllowanceOverride::query()->where('billing_account_id', $account->getKey())->get())
            ->keyBy(fn (AllowanceOverride $override): string => $override->kind->value);
        $inherited = $this->inheritedAll($account);
        $resolved = [];

        foreach (AllowanceKind::cases() as $kind) {
            $override = $overrides->get($kind->value);
            $resolved[$kind->value] = $override === null
                ? $inherited[$kind->value]
                : new ResolvedAllowance($kind, $override->value, 'override', $override->note);
        }

        return $resolved;
    }

    /**
     * What the plan or the deployment gives, ignoring any override.
     */
    public function inherited(BillingAccount $account, AllowanceKind $kind): ResolvedAllowance
    {
        return $this->inheritedAll($account)[$kind->value];
    }

    public function override(BillingAccount $account, AllowanceKind $kind, ?int $value, string $note, User $actor): void
    {
        $this->validate($kind, $value);

        DB::transaction(function () use ($account, $kind, $value, $note, $actor): void {
            $before = $this->resolve($account, $kind);
            $now = now();
            AllowanceOverride::query()->upsert(
                [[
                    'billing_account_id' => $account->getKey(),
                    'kind' => $kind->value,
                    'value' => $value,
                    'note' => $note,
                    'set_by' => $actor->getKey(),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]],
                ['billing_account_id', 'kind'],
                ['value', 'note', 'set_by', 'updated_at'],
            );

            ActivityLog::record('billing_account.allowance_overridden', null, $actor, $account, [
                'kind' => $kind->value,
                'from' => $before->value,
                'from_source' => $before->source,
                'to' => $value,
                'note' => $note,
            ]);
        });
    }

    public function removeOverride(BillingAccount $account, AllowanceKind $kind, User $actor): void
    {
        DB::transaction(function () use ($account, $kind, $actor): void {
            $override = AllowanceOverride::query()
                ->where('billing_account_id', $account->getKey())
                ->where('kind', $kind->value)
                ->lockForUpdate()
                ->first();

            if ($override === null) {
                return;
            }

            AllowanceOverride::query()
                ->where('billing_account_id', $account->getKey())
                ->where('kind', $kind->value)
                ->delete();
            $after = $this->inherited($account, $kind);

            ActivityLog::record('billing_account.allowance_override_removed', null, $actor, $account, [
                'kind' => $kind->value,
                'from' => $override->value,
                'to' => $after->value,
                'to_source' => $after->source,
            ]);
        });
    }

    /**
     * Refuses a value the kind cannot take: retention is never unlimited, and every
     * kind has its bounds.
     */
    public function validate(AllowanceKind $kind, ?int $value, string $field = 'value'): void
    {
        if ($value === null && ! $kind->allowsUnlimited()) {
            throw ValidationException::withMessages([$field => 'Retention needs a number of days.']);
        }

        if ($value !== null && ($value < $kind->minimum() || $value > $kind->maximum())) {
            throw ValidationException::withMessages([$field => sprintf(
                'Enter a whole number from %s to %s.',
                number_format($kind->minimum()),
                number_format($kind->maximum()),
            )]);
        }
    }

    /**
     * @return array<string, ResolvedAllowance>
     */
    private function inheritedAll(BillingAccount $account): array
    {
        $planRows = $this->planRows($account)
            ->keyBy(fn (PlanAllowance $allowance): string => $allowance->kind->value);
        $defaults = (array) config('billing.defaults');
        $inherited = [];

        foreach (AllowanceKind::cases() as $kind) {
            $row = $planRows->get($kind->value);
            $inherited[$kind->value] = $row === null
                ? new ResolvedAllowance($kind, self::number($defaults[$kind->value] ?? null), 'default')
                : new ResolvedAllowance($kind, $row->value, 'plan');
        }

        return $inherited;
    }

    /**
     * @return Collection<int, PlanAllowance>
     */
    private function planRows(BillingAccount $account): Collection
    {
        if ($account->relationLoaded('openPlanAssignment')) {
            $plan = $account->openPlanAssignment?->plan;

            return $plan === null ? collect() : $plan->allowances->toBase();
        }

        $planId = PlanAssignment::query()
            ->where('billing_account_id', $account->getKey())
            ->whereNull('ended_at')
            ->value('billing_plan_id');

        return $planId === null
            ? collect()
            : PlanAllowance::query()->where('billing_plan_id', $planId)->get()->toBase();
    }

    private static function number(mixed $value): ?int
    {
        return $value === null ? null : (int) $value;
    }
}
