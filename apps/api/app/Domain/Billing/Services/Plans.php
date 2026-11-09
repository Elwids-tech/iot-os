<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAllowance;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Devices\Services\RetentionGuard;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

/**
 * Platform administrators define plans (spec 028 US1). Editing a plan's allowances
 * changes every account on it at once, so it needs the number of accounts it affects
 * confirmed (FR-003). Every change is audited on the plan (FR-006).
 */
final class Plans
{
    public function __construct(private readonly Allowances $allowances) {}

    /**
     * @param  array{name: string, description?: string|null, allowances?: array<string, int|null>}  $values
     */
    public function create(array $values, User $actor): BillingPlan
    {
        $allowances = $this->allowanceMap($values['allowances'] ?? []);

        return DB::transaction(function () use ($values, $allowances, $actor): BillingPlan {
            $plan = BillingPlan::query()->create([
                'name' => $values['name'],
                'description' => $values['description'] ?? null,
            ]);
            $this->writeAllowances($plan, $allowances);

            ActivityLog::record('billing_plan.created', null, $actor, $plan, [
                'name' => $plan->name,
                'allowances' => $allowances,
            ]);

            return $plan;
        });
    }

    /**
     * `allowances`, when given, is the plan's complete set: a kind left out falls back to
     * the deployment's default.
     *
     * @param  array{name?: string, description?: string|null, allowances?: array<string, int|null>}  $values
     */
    public function update(BillingPlan $plan, array $values, User $actor, ?int $confirmAffected, bool $confirmRetention = false): BillingPlan
    {
        $allowances = array_key_exists('allowances', $values) ? $this->allowanceMap($values['allowances']) : null;

        if ($allowances === null) {
            return $this->applyUpdate($plan, $values, null, $actor, $confirmAffected);
        }

        // A shorter retention reaches every organization of the accounts on the plan (spec 029 US4).
        $organizations = RetentionGuard::organizationsOf(BillingAccount::query()
            ->whereIn('id', PlanAssignment::query()->where('billing_plan_id', $plan->getKey())->whereNull('ended_at')->select('billing_account_id'))
            ->get()
            ->all());

        return app(RetentionGuard::class)->around(
            $organizations,
            fn (): BillingPlan => $this->applyUpdate($plan, $values, $allowances, $actor, $confirmAffected),
            'plan_edited',
            $confirmRetention,
        );
    }

    /**
     * @param  array<string, int|null>|null  $allowances
     */
    private function applyUpdate(BillingPlan $plan, array $values, ?array $allowances, User $actor, ?int $confirmAffected): BillingPlan
    {
        return DB::transaction(function () use ($plan, $values, $allowances, $actor, $confirmAffected): BillingPlan {
            $locked = BillingPlan::query()->whereKey($plan->getKey())->lockForUpdate()->firstOrFail();
            $changes = [];

            foreach (['name', 'description'] as $field) {
                if (array_key_exists($field, $values) && $values[$field] !== $locked->getAttribute($field)) {
                    $changes[$field] = ['from' => $locked->getAttribute($field), 'to' => $values[$field]];
                    $locked->setAttribute($field, $values[$field]);
                }
            }

            $before = $this->currentAllowances($locked);
            $allowanceChanges = [];

            if ($allowances !== null) {
                foreach (AllowanceKind::values() as $kind) {
                    $from = array_key_exists($kind, $before) ? $before[$kind] : 'default';
                    $to = array_key_exists($kind, $allowances) ? $allowances[$kind] : 'default';

                    if ($from !== $to) {
                        $allowanceChanges[$kind] = ['from' => $from, 'to' => $to];
                    }
                }
            }

            if ($allowanceChanges !== []) {
                $affected = $this->accountsOn($locked);

                if ($affected > 0 && $confirmAffected !== $affected) {
                    throw new HttpResponseException(response()->json([
                        'message' => sprintf(
                            'This changes the allowances of %d billing %s. Confirm to apply it to all of them.',
                            $affected,
                            $affected === 1 ? 'account' : 'accounts',
                        ),
                        'affected_accounts' => $affected,
                    ], 409));
                }

                PlanAllowance::query()->where('billing_plan_id', $locked->getKey())->delete();
                $this->writeAllowances($locked, $allowances ?? []);
                if (array_key_exists(AllowanceKind::Devices->value, $allowanceChanges)) {
                    BillingAccount::query()
                        ->whereHas('planAssignments', fn ($query) => $query->whereNull('ended_at')->where('billing_plan_id', $locked->getKey()))
                        ->each(fn (BillingAccount $account) => app(DeviceLimit::class)->recheck($account));
                }
            }

            if ($changes === [] && $allowanceChanges === []) {
                return $locked;
            }

            $locked->save();
            ActivityLog::record('billing_plan.updated', null, $actor, $locked, [
                'changes' => $changes,
                'allowances' => $allowanceChanges,
            ]);

            return $locked;
        });
    }

    public function archive(BillingPlan $plan, User $actor): BillingPlan
    {
        if ($plan->isArchived()) {
            return $plan;
        }

        $plan->forceFill(['archived_at' => now()])->save();
        ActivityLog::record('billing_plan.archived', null, $actor, $plan, ['name' => $plan->name]);

        return $plan;
    }

    public function restore(BillingPlan $plan, User $actor): BillingPlan
    {
        if (! $plan->isArchived()) {
            return $plan;
        }

        $plan->forceFill(['archived_at' => null])->save();
        ActivityLog::record('billing_plan.restored', null, $actor, $plan, ['name' => $plan->name]);

        return $plan;
    }

    /**
     * Deletes a plan that was never assigned; one that was is a 409 (FR-005).
     */
    public function delete(BillingPlan $plan, User $actor): void
    {
        DB::transaction(function () use ($plan, $actor): void {
            $locked = BillingPlan::query()->whereKey($plan->getKey())->lockForUpdate()->firstOrFail();

            abort_if(
                PlanAssignment::query()->where('billing_plan_id', $locked->getKey())->exists(),
                409,
                'This plan has been assigned to a billing account, so it cannot be deleted. Archive it instead.',
            );

            $locked->delete();
            ActivityLog::record('billing_plan.deleted', null, $actor, $locked->uuid, ['name' => $locked->name]);
        });
    }

    public function accountsOn(BillingPlan $plan): int
    {
        return PlanAssignment::query()
            ->where('billing_plan_id', $plan->getKey())
            ->whereNull('ended_at')
            ->count();
    }

    /**
     * @return array<string, int|null>
     */
    public function currentAllowances(BillingPlan $plan): array
    {
        return PlanAllowance::query()
            ->where('billing_plan_id', $plan->getKey())
            ->get()
            ->mapWithKeys(fn (PlanAllowance $allowance): array => [$allowance->kind->value => $allowance->value])
            ->all();
    }

    /**
     * Validates every value and orders the map by kind.
     *
     * @param  array<string, int|null>  $allowances
     * @return array<string, int|null>
     */
    private function allowanceMap(array $allowances): array
    {
        $map = [];

        foreach (AllowanceKind::cases() as $kind) {
            if (! array_key_exists($kind->value, $allowances)) {
                continue;
            }

            $value = $allowances[$kind->value] === null ? null : (int) $allowances[$kind->value];
            $this->allowances->validate($kind, $value, 'allowances.'.$kind->value);
            $map[$kind->value] = $value;
        }

        return $map;
    }

    /**
     * @param  array<string, int|null>  $allowances
     */
    private function writeAllowances(BillingPlan $plan, array $allowances): void
    {
        $rows = [];

        foreach ($allowances as $kind => $value) {
            $rows[] = ['billing_plan_id' => $plan->getKey(), 'kind' => $kind, 'value' => $value];
        }

        if ($rows !== []) {
            PlanAllowance::query()->insert($rows);
        }
    }
}
