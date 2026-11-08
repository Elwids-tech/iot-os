<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Mail\TrialMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Devices\Services\RetentionGuard;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Trials (spec 029 US8, research R4): a trial is a `trial` plan assignment, limited by
 * `trial_ends_at` or open-ended, with the plan's allowances and limits and no charge.
 * When it ends the account stays on its plan: `paid` with a saved card, otherwise
 * `trial_unpaid` (flagged, still not charged) until a card is saved or an administrator
 * converts it. Each step closes the open assignment and opens the next at one instant;
 * invoices charge each day to the assignment in force at 00:00 UTC, so a trial that ends
 * during a day is charged from the next. An account has at most one open trial.
 */
final class Trials
{
    public function __construct(
        private readonly PlanAssignments $assignments,
        private readonly Notices $notices,
    ) {}

    /**
     * Starts a trial now, on the account's plan unless another is given.
     */
    public function start(BillingAccount $account, ?BillingPlan $plan, ?CarbonImmutable $endsAt, ?User $actor, bool $confirmRetention = false): PlanAssignment
    {
        $plan ??= $this->assignments->current($account)?->plan;
        self::assertAssignable($plan);

        // A trial plan with a shorter retention needs confirmation and waits out its grace (spec 029 US4).
        return app(RetentionGuard::class)->around(RetentionGuard::organizationsOf([$account]), fn (): PlanAssignment => DB::transaction(function () use ($account, $plan, $endsAt, $actor): PlanAssignment {
            $open = $this->assignments->lock($account);
            abort_if($open?->kind === PlanAssignmentKind::Trial, 409, 'This billing account is already on a trial. Change or end it instead.');

            $trial = $this->assignments->replace($open, $account, $plan, PlanAssignmentKind::Trial, $actor, 'changed', $endsAt);
            ActivityLog::record('billing_account.trial_started', null, $actor, $account, [
                'plan' => ['uuid' => $plan->uuid, 'name' => $plan->name],
                'ends_at' => $endsAt?->toIso8601String(),
                'from' => $open === null ? null : ['uuid' => $open->plan->uuid, 'name' => $open->plan->name, 'kind' => $open->kind->value],
            ]);

            return $trial;
        }), 'trial', $confirmRetention);
    }

    /**
     * Extends or shortens the open trial (null: no end date) and can move it to another
     * plan, which closes this trial's assignment and opens one on the new plan.
     */
    public function change(BillingAccount $account, ?CarbonImmutable $endsAt, ?BillingPlan $plan, ?User $actor, bool $confirmRetention = false): PlanAssignment
    {
        return app(RetentionGuard::class)->around(RetentionGuard::organizationsOf([$account]), fn (): PlanAssignment => DB::transaction(function () use ($account, $endsAt, $plan, $actor): PlanAssignment {
            $trial = $this->openTrial($account);
            $from = ['plan' => $trial->plan->name, 'ends_at' => $trial->trial_ends_at?->toIso8601String()];

            if ($plan !== null && $plan->getKey() !== $trial->billing_plan_id) {
                self::assertAssignable($plan);
                $trial = $this->assignments->replace($trial, $account, $plan, PlanAssignmentKind::Trial, $actor, 'changed', $endsAt);
            } else {
                $trial->forceFill(['trial_ends_at' => $endsAt])->save();
            }

            ActivityLog::record('billing_account.trial_changed', null, $actor, $account, [
                'from' => $from,
                'to' => ['plan' => $trial->plan->name, 'ends_at' => $endsAt?->toIso8601String()],
            ]);

            return $trial;
        }), 'trial', $confirmRetention);
    }

    /**
     * Ends the open trial now: `paid` with a saved card, else `trial_unpaid`. The owners
     * are emailed.
     */
    public function end(BillingAccount $account, ?User $actor): PlanAssignment
    {
        return DB::transaction(fn (): PlanAssignment => $this->finish($account, $this->openTrial($account), 'trial_ended_by_admin', $actor, CarbonImmutable::now()));
    }

    /**
     * Turns a trial, or a trial that ended without a card, into the paid plan at once.
     */
    public function convert(BillingAccount $account, ?User $actor): PlanAssignment
    {
        return DB::transaction(function () use ($account, $actor): PlanAssignment {
            $open = $this->assignments->lock($account);
            abort_unless(in_array($open?->kind, [PlanAssignmentKind::Trial, PlanAssignmentKind::TrialUnpaid], true), 409, 'This billing account is not on a trial.');

            /** @var PlanAssignment $open */
            $next = $this->assignments->replace($open, $account, $open->plan, PlanAssignmentKind::Paid, $actor, 'trial_converted');
            $this->ended($account, $open, $next, 'trial_converted', $actor);

            return $next;
        });
    }

    /**
     * A card saved on an account whose trial ended without one (spec 029 FR-050): the
     * paid plan starts at once, so it is charged from the next day. During a trial a
     * card changes nothing until the trial ends.
     */
    public function paymentMethodAdded(BillingAccount $account): void
    {
        DB::transaction(function () use ($account): void {
            $open = $this->assignments->lock($account);
            if ($open?->kind !== PlanAssignmentKind::TrialUnpaid) {
                return;
            }

            $next = $this->assignments->replace($open, $account, $open->plan, PlanAssignmentKind::Paid, null, 'payment_method_added');
            $this->ended($account, $open, $next, 'payment_method_added', null);
        });
    }

    /**
     * Ends every limited trial whose end date has passed as of `$asOf`, at that date
     * even when the job ran late (spec 029 edge cases), but never later than now.
     */
    public function endDue(CarbonImmutable $asOf): int
    {
        $ended = 0;

        PlanAssignment::query()
            ->open()
            ->where('kind', PlanAssignmentKind::Trial->value)
            ->whereNotNull('trial_ends_at')
            ->where('trial_ends_at', '<=', $asOf)
            ->whereHas('billingAccount', fn ($query) => $query->whereNull('deleted_at'))
            ->with('billingAccount')
            ->get()
            ->each(function (PlanAssignment $due) use ($asOf, &$ended): void {
                DB::transaction(function () use ($due, $asOf, &$ended): void {
                    // Changed since it was read: converted, ended or extended meanwhile.
                    $open = $this->assignments->lock($due->billingAccount);
                    if ($open === null || ! $open->is($due) || $open->trial_ends_at === null || $open->trial_ends_at->greaterThan($asOf)) {
                        return;
                    }

                    $this->finish($due->billingAccount, $open, 'trial_reached_end', null, $open->trial_ends_at->min(CarbonImmutable::now()));
                    $ended++;
                });
            });

        return $ended;
    }

    /**
     * @param  'trial_reached_end'|'trial_ended_by_admin'  $reason
     */
    private function finish(BillingAccount $account, PlanAssignment $trial, string $reason, ?User $actor, CarbonImmutable $at): PlanAssignment
    {
        $kind = $account->refresh()->pm_type !== null ? PlanAssignmentKind::Paid : PlanAssignmentKind::TrialUnpaid;
        $next = $this->assignments->replace($trial, $account, $trial->plan, $kind, $actor, $reason, at: $at);
        $this->ended($account, $trial, $next, $reason, $actor);

        return $next;
    }

    private function openTrial(BillingAccount $account): PlanAssignment
    {
        $open = $this->assignments->lock($account);
        abort_unless($open?->kind === PlanAssignmentKind::Trial, 409, 'This billing account is not on a trial.');

        return $open;
    }

    /**
     * Audits the trial's end and, when a `trial` ended, emails the owners once.
     */
    private function ended(BillingAccount $account, PlanAssignment $from, PlanAssignment $next, string $reason, ?User $actor): void
    {
        ActivityLog::record('billing_account.trial_ended', null, $actor, $account, [
            'plan' => ['uuid' => $from->plan->uuid, 'name' => $from->plan->name],
            'from' => $from->kind->value,
            'to' => $next->kind->value,
            'reason' => $reason,
            'at' => $next->started_at->toIso8601String(),
        ]);

        if ($from->kind === PlanAssignmentKind::Trial) {
            $this->notices->send($account, 'trial_ended', 'trial:'.$from->uuid.':ended', TrialMail::ended($account, $from, $next));
        }
    }

    /**
     * @phpstan-assert BillingPlan $plan
     */
    private static function assertAssignable(?BillingPlan $plan): void
    {
        if ($plan === null) {
            throw ValidationException::withMessages(['plan_uuid' => 'Choose a plan for the trial. This account is on none.']);
        }

        if ($plan->isArchived()) {
            throw ValidationException::withMessages(['plan_uuid' => 'This plan is archived. Restore it before starting a trial on it.']);
        }
    }
}
