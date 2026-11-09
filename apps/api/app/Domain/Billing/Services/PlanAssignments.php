<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Devices\Services\RetentionGuard;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Which plan a billing account is on, and since when (spec 028 FR-007, ADR-035). The
 * account row is locked while the open assignment is closed and the next one opened,
 * at one timestamp, so periods never overlap and a gap means no plan.
 */
final class PlanAssignments
{
    public function assign(BillingAccount $account, BillingPlan $plan, ?User $actor, PlanAssignmentKind $kind = PlanAssignmentKind::Paid, bool $confirmRetention = false): PlanAssignment
    {
        if ($plan->isArchived()) {
            throw ValidationException::withMessages(['plan_uuid' => 'This plan is archived. Restore it before assigning it.']);
        }

        // A plan with a shorter retention needs confirmation and waits out its grace (spec 029 US4).
        return app(RetentionGuard::class)->around(RetentionGuard::organizationsOf([$account]), fn (): PlanAssignment => DB::transaction(function () use ($account, $plan, $actor, $kind): PlanAssignment {
            BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();
            $open = $this->current($account);

            if ($open !== null && $open->billing_plan_id === $plan->getKey() && $open->kind === $kind) {
                return $open;
            }

            $at = now();

            if ($open !== null) {
                $open->forceFill(['ended_at' => $at, 'ended_by' => $actor?->getKey(), 'end_reason' => 'changed'])->save();
            }

            $assignment = PlanAssignment::query()->create([
                'billing_account_id' => $account->getKey(),
                'billing_plan_id' => $plan->getKey(),
                'kind' => $kind,
                'started_at' => $at,
                'assigned_by' => $actor?->getKey(),
            ]);

            app(DeviceLimit::class)->recheck($account);
            ActivityLog::record('billing_account.plan_assigned', null, $actor, $account, [
                'from' => $open === null ? null : ['uuid' => $open->plan->uuid, 'name' => $open->plan->name],
                'to' => ['uuid' => $plan->uuid, 'name' => $plan->name],
                'kind' => $kind->value,
            ]);

            return $assignment;
        }), 'plan_changed', $confirmRetention);
    }

    /**
     * Takes the account off its plan; it falls back to the deployment's defaults.
     */
    public function remove(BillingAccount $account, User $actor, bool $confirmRetention = false): void
    {
        app(RetentionGuard::class)->around(RetentionGuard::organizationsOf([$account]), fn () => DB::transaction(function () use ($account, $actor): void {
            BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();
            $open = $this->current($account);

            if ($open === null) {
                return;
            }

            $open->forceFill(['ended_at' => now(), 'ended_by' => $actor->getKey(), 'end_reason' => 'removed'])->save();
            app(DeviceLimit::class)->recheck($account);
            ActivityLog::record('billing_account.plan_removed', null, $actor, $account, [
                'from' => ['uuid' => $open->plan->uuid, 'name' => $open->plan->name],
            ]);
        }), 'plan_changed', $confirmRetention);
    }

    /**
     * Closes the open assignment and opens the next at one instant, for the trial steps
     * (spec 029 US8). The caller holds the account's lock (`lock`) in a transaction.
     */
    public function replace(?PlanAssignment $open, BillingAccount $account, BillingPlan $plan, PlanAssignmentKind $kind, ?User $actor, string $endReason, ?CarbonImmutable $trialEndsAt = null, ?CarbonImmutable $at = null): PlanAssignment
    {
        $at ??= CarbonImmutable::now();
        $open?->forceFill(['ended_at' => $at, 'ended_by' => $actor?->getKey(), 'end_reason' => $endReason])->save();
        if ($open?->billing_plan_id !== $plan->getKey()) {
            app(DeviceLimit::class)->recheck($account);
        }

        return PlanAssignment::query()->create([
            'billing_account_id' => $account->getKey(),
            'billing_plan_id' => $plan->getKey(),
            'kind' => $kind,
            'started_at' => $at,
            'trial_ends_at' => $trialEndsAt,
            'assigned_by' => $actor?->getKey(),
        ])->setRelation('plan', $plan);
    }

    /**
     * Locks the account row and returns its open assignment.
     */
    public function lock(BillingAccount $account): ?PlanAssignment
    {
        BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();

        return $this->current($account);
    }

    public function current(BillingAccount $account): ?PlanAssignment
    {
        return PlanAssignment::query()
            ->where('billing_account_id', $account->getKey())
            ->whereNull('ended_at')
            ->with('plan')
            ->first();
    }

    /**
     * The assignment in force at an instant since rollout (spec 028 SC-007).
     */
    public function at(BillingAccount $account, CarbonImmutable $instant): ?PlanAssignment
    {
        return PlanAssignment::query()
            ->where('billing_account_id', $account->getKey())
            ->where('started_at', '<=', $instant)
            ->where(fn ($query) => $query->whereNull('ended_at')->orWhere('ended_at', '>', $instant))
            ->with('plan')
            ->orderByDesc('started_at')
            ->first();
    }
}
