<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Enums\InvoiceLineKind;
use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Models\InvoiceLine;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Support\Money;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Drafts monthly invoices (spec 029 FR-031–FR-034, FR-038, research R13). Each UTC day
 * is charged to the plan assignment in force at 00:00 that day, so a plan assigned
 * mid-day starts charging the next day; consecutive days of one assignment make one
 * line, its base price prorated by day (trial days at 0). Overage is priced per
 * assignment at that plan's prices for the month, with the account's overrides: alerts
 * one by one, data points by whole blocks rounded up, and nothing during a trial.
 *
 * A draft waits until the runtime has reported the month's data points to its end;
 * an administrator can draft anyway, which marks it possibly incomplete. Drafts are
 * recalculated from the records at any time, keeping adjustments, and show the account's
 * credit after tax as it would apply at issue.
 */
final class InvoiceDrafter
{
    public function __construct(private readonly Prices $prices) {}

    public function draft(BillingAccount $account, CarbonImmutable $month, ?User $actor, ?string $note): Invoice
    {
        $month = $month->utc()->startOfMonth();
        if ($month->greaterThan(CarbonImmutable::now()->utc()->startOfMonth())) {
            throw ValidationException::withMessages(['month' => 'A month that has not started cannot be invoiced.']);
        }

        return DB::transaction(function () use ($account, $month, $actor, $note): Invoice {
            // Read fresh under the lock: the caller's model may hold an old tax rate.
            $account = BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();
            abort_if(
                Invoice::query()->where('billing_account_id', $account->getKey())->whereDate('month', $month->toDateString())->exists(),
                409,
                sprintf('%s already has an invoice for %s.', $account->name, $month->format('F Y')),
            );

            $invoice = Invoice::query()->create([
                'billing_account_id' => $account->getKey(),
                'month' => $month->toDateString(),
                'status' => Invoice::DRAFT,
                'usage_incomplete' => ! $this->usageFinal($month),
                'draft_note' => $note,
                'currency' => (string) config('billing.currency'),
                'payment_status' => PaymentStatus::Pending,
                'drafted_by' => $actor?->getKey(),
                'drafted_at' => now(),
            ]);
            $this->fill($invoice, $account);
            ActivityLog::record('billing_invoice.drafted', null, $actor, $invoice, [
                'billing_account_uuid' => $account->uuid,
                'month' => $month->toDateString(),
                'usage_incomplete' => $invoice->usage_incomplete,
                'note' => $note,
            ]);

            return $invoice->refresh();
        });
    }

    /** Rebuilds a draft from the records, keeping its adjustments. */
    public function recalculate(Invoice $invoice, User $actor): Invoice
    {
        return DB::transaction(function () use ($invoice, $actor): Invoice {
            $locked = $this->lockedDraft($invoice);
            $locked->forceFill(['usage_incomplete' => $locked->usage_incomplete && ! $this->usageFinal($locked->month)])->save();
            $this->fill($locked, $locked->billingAccount);
            ActivityLog::record('billing_invoice.adjusted', null, $actor, $locked, ['change' => 'recalculated']);

            return $locked->refresh();
        });
    }

    /** A charge (positive) or credit (negative) on a draft, with a note (FR-034). */
    public function addAdjustment(Invoice $invoice, string $description, int $amount, string $note, User $actor): Invoice
    {
        return DB::transaction(function () use ($invoice, $description, $amount, $note, $actor): Invoice {
            $locked = $this->lockedDraft($invoice);
            $line = $locked->lines()->create([
                'position' => (int) $locked->lines()->max('position') + 1,
                'kind' => InvoiceLineKind::Adjustment,
                'description' => $description,
                'quantity' => 1,
                'unit_price' => $amount,
                'amount' => $amount,
                'note' => $note,
                'created_by' => $actor->getKey(),
            ]);
            $this->totals($locked, $locked->billingAccount);
            ActivityLog::record('billing_invoice.adjusted', null, $actor, $locked, [
                'change' => 'adjustment_added',
                'line_id' => $line->getKey(),
                'description' => $description,
                'amount' => $amount,
                'note' => $note,
            ]);

            return $locked->refresh();
        });
    }

    public function removeAdjustment(Invoice $invoice, InvoiceLine $line, User $actor): Invoice
    {
        return DB::transaction(function () use ($invoice, $line, $actor): Invoice {
            $locked = $this->lockedDraft($invoice);
            abort_unless($line->invoice_id === $locked->getKey() && $line->kind === InvoiceLineKind::Adjustment, 404);
            $line->delete();
            $this->totals($locked, $locked->billingAccount);
            ActivityLog::record('billing_invoice.adjusted', null, $actor, $locked, [
                'change' => 'adjustment_removed',
                'description' => $line->description,
                'amount' => $line->amount,
            ]);

            return $locked->refresh();
        });
    }

    /**
     * Drafts last month's invoices that are due (`billing:draft-invoices`): every account
     * with a plan during the month and no invoice for it, once its usage is final.
     *
     * @return int how many were drafted
     */
    public function draftDue(CarbonImmutable $now): int
    {
        $month = $now->utc()->startOfMonth()->subMonthNoOverflow();
        if (! $this->usageFinal($month)) {
            return 0;
        }

        $drafted = 0;
        foreach ($this->dueAccounts($month) as $account) {
            $this->draft($account, $month, null, null);
            $drafted++;
        }

        return $drafted;
    }

    /**
     * Accounts that had a plan during a month and have no invoice for it.
     *
     * @return Collection<int, BillingAccount>
     */
    public function dueAccounts(CarbonImmutable $month): Collection
    {
        $month = $month->utc()->startOfMonth();
        $end = $month->addMonthNoOverflow();

        return BillingAccount::query()
            ->whereHas('planAssignments', fn ($query) => $query
                ->where('started_at', '<', $end)
                ->where(fn ($query) => $query->whereNull('ended_at')->orWhere('ended_at', '>', $month)))
            ->whereDoesntHave('invoices', fn ($query) => $query->whereDate('month', $month->toDateString()))
            ->orderBy('name')
            ->get();
    }

    /**
     * Accounts whose invoice for an ended month waits for final usage, and since when
     * (the month's end). Empty once usage is final: the daily job drafts them then.
     *
     * @return list<array{account: BillingAccount, waiting_since: CarbonImmutable}>
     */
    public function waiting(CarbonImmutable $month): array
    {
        $month = $month->utc()->startOfMonth();
        $end = $month->addMonthNoOverflow();
        if ($end->greaterThan(CarbonImmutable::now()) || $this->usageFinal($month)) {
            return [];
        }

        return $this->dueAccounts($month)
            ->map(fn (BillingAccount $account): array => ['account' => $account, 'waiting_since' => $end])
            ->values()
            ->all();
    }

    /** The runtime has reported data points up to the month's end (research R9). */
    public function usageFinal(CarbonImmutable $month): bool
    {
        $watermark = DB::table('billing_usage_watermarks')->where('source', DataPointReports::SOURCE)->value('final_through');

        return $watermark !== null
            && CarbonImmutable::parse((string) $watermark)->greaterThanOrEqualTo($month->utc()->startOfMonth()->addMonthNoOverflow());
    }

    /**
     * The lines a month's records give, without adjustments or credit: what a draft holds
     * and what `recompute == stored` checks (SC-009).
     *
     * @return list<array{kind: InvoiceLineKind, description: string, quantity: int, unit_price: ?int, amount: int, period_start: ?string, period_end: ?string, plan_assignment_id: ?int, note: ?string}>
     */
    public function computeLines(BillingAccount $account, CarbonImmutable $month): array
    {
        $month = $month->utc()->startOfMonth();
        $end = $month->addMonthNoOverflow();
        $days = $month->daysInMonth;
        $assignments = PlanAssignment::query()
            ->where('billing_account_id', $account->getKey())
            ->where('started_at', '<', $end)
            ->where(fn ($query) => $query->whereNull('ended_at')->orWhere('ended_at', '>', $month))
            ->with('plan')
            ->orderBy('started_at')
            ->get();

        // Consecutive days charged to one assignment, each day by the one in force at 00:00.
        $runs = [];
        for ($day = 0; $day < $days; $day++) {
            $instant = $month->addDays($day);
            $assignment = $assignments->last(fn (PlanAssignment $item): bool => $item->started_at->lessThanOrEqualTo($instant)
                && ($item->ended_at === null || $item->ended_at->greaterThan($instant)));
            if ($assignment === null) {
                continue;
            }
            $last = array_key_last($runs);
            if ($last !== null && $runs[$last]['assignment']->is($assignment) && $runs[$last]['to'] === $day - 1) {
                $runs[$last]['to'] = $day;
            } else {
                $runs[] = ['assignment' => $assignment, 'from' => $day, 'to' => $day];
            }
        }

        $lines = [];
        foreach ($runs as $run) {
            /** @var PlanAssignment $assignment */
            $assignment = $run['assignment'];
            $count = $run['to'] - $run['from'] + 1;
            $start = $month->addDays($run['from']);
            $stop = $month->addDays($run['to']);
            $trial = $assignment->kind !== PlanAssignmentKind::Paid;
            $base = $this->prices->for($account, $assignment->billing_plan_id, $month)['base_price'];
            $lines[] = [
                'kind' => $trial ? InvoiceLineKind::Trial : InvoiceLineKind::BasePrice,
                'description' => sprintf(
                    '%s%s · %s (%d of %d days)',
                    $assignment->plan->name,
                    $trial ? ' trial' : '',
                    self::period($start, $stop),
                    $count,
                    $days,
                ),
                'quantity' => $count,
                'unit_price' => $trial ? 0 : $base,
                'amount' => $trial ? 0 : Money::share($base, $count, $days),
                'period_start' => $start->toDateString(),
                'period_end' => $stop->toDateString(),
                'plan_assignment_id' => (int) $assignment->getKey(),
                'note' => null,
            ];
        }

        $overage = DB::table('billing_overage')
            ->where('billing_account_id', $account->getKey())
            ->whereDate('month', $month->toDateString())
            ->whereNotNull('plan_assignment_id')
            ->whereIn('kind', [AllowanceKind::Alerts->value, AllowanceKind::DataPoints->value])
            ->where('quantity', '>', 0)
            ->get();
        $byId = PlanAssignment::query()->whereIn('id', $overage->pluck('plan_assignment_id'))->with('plan')->get()->keyBy('id');
        $sorted = $overage->sortBy(fn (object $row): string => sprintf(
            '%s|%d',
            $byId[$row->plan_assignment_id]->started_at->format('YmdHis'),
            $row->kind === AllowanceKind::Alerts->value ? 0 : 1,
        ));
        foreach ($sorted as $row) {
            $assignment = $byId[$row->plan_assignment_id];
            $trial = $assignment->kind !== PlanAssignmentKind::Paid;
            $prices = $this->prices->for($account, $assignment->billing_plan_id, $month);
            $quantity = (int) $row->quantity;
            if ($row->kind === AllowanceKind::Alerts->value) {
                $unit = $trial ? 0 : $prices['alert_overage_price'];
                $lines[] = [
                    'kind' => InvoiceLineKind::AlertOverage,
                    'description' => sprintf('Alert overage · %s · %s %s', $assignment->plan->name, number_format($quantity), $quantity === 1 ? 'alert' : 'alerts'),
                    'quantity' => $quantity,
                    'unit_price' => $unit,
                    'amount' => $quantity * $unit,
                    'period_start' => null,
                    'period_end' => null,
                    'plan_assignment_id' => (int) $assignment->getKey(),
                    'note' => $trial ? 'Not charged during trial' : null,
                ];

                continue;
            }
            $block = max(1, $prices['data_point_block_size']);
            $blocks = intdiv($quantity + $block - 1, $block);
            $unit = $trial ? 0 : $prices['data_point_overage_price'];
            $lines[] = [
                'kind' => InvoiceLineKind::DataPointOverage,
                'description' => sprintf(
                    'Data point overage · %s · %s data points in %s %s of %s',
                    $assignment->plan->name,
                    number_format($quantity),
                    number_format($blocks),
                    $blocks === 1 ? 'block' : 'blocks',
                    number_format($block),
                ),
                'quantity' => $blocks,
                'unit_price' => $unit,
                'amount' => $blocks * $unit,
                'period_start' => null,
                'period_end' => null,
                'plan_assignment_id' => (int) $assignment->getKey(),
                'note' => $trial ? 'Not charged during trial' : null,
            ];
        }

        return $lines;
    }

    /**
     * Subtotal, tax at the account's rate, total, and the account's credit after tax as a
     * last `credit` line (research R14). Issuing does the same with the rate it snapshots.
     */
    public function totals(Invoice $invoice, BillingAccount $account): void
    {
        $invoice->lines()->where('kind', InvoiceLineKind::Credit->value)->delete();
        $subtotal = (int) $invoice->lines()->sum('amount');
        $rate = $account->taxRate;
        $tax = $rate === null ? 0 : Money::tax($subtotal, $rate->basis_points);
        $total = $subtotal + $tax;
        $credit = min(max(0, $total), $this->creditBalance($account));
        if ($credit > 0) {
            $invoice->lines()->create([
                'position' => (int) $invoice->lines()->max('position') + 1,
                'kind' => InvoiceLineKind::Credit,
                'description' => 'Credit from '.implode(', ', $this->creditSources($account)),
                'quantity' => 1,
                'unit_price' => null,
                'amount' => -$credit,
            ]);
        }
        $invoice->forceFill([
            'tax_rate_name' => $rate?->name,
            'tax_basis_points' => $rate?->basis_points,
            'subtotal' => $subtotal,
            'tax' => $tax,
            'total' => $total,
            'credit_applied' => $credit,
            'amount_due' => $total - $credit,
        ])->save();
    }

    /** The account's credit not yet used by an issued invoice. */
    public function creditBalance(BillingAccount $account): int
    {
        return max(0, (int) DB::table('billing_account_credits')->where('billing_account_id', $account->getKey())->sum('amount'));
    }

    /**
     * The credit notes whose credit is still unused, oldest used first.
     *
     * @return list<string>
     */
    private function creditSources(BillingAccount $account): array
    {
        $rows = DB::table('billing_account_credits')
            ->leftJoin('billing_credit_notes', 'billing_credit_notes.id', '=', 'billing_account_credits.credit_note_id')
            ->where('billing_account_credits.billing_account_id', $account->getKey())
            ->orderBy('billing_account_credits.id')
            ->get(['billing_account_credits.amount', 'billing_credit_notes.number']);
        $used = -(int) $rows->where('amount', '<', 0)->sum('amount');
        $sources = [];
        foreach ($rows->where('amount', '>', 0) as $row) {
            $left = (int) $row->amount - $used;
            $used = max(0, $used - (int) $row->amount);
            if ($left > 0 && $row->number !== null) {
                $sources[] = (string) $row->number;
            }
        }

        return $sources === [] ? ['earlier credit'] : $sources;
    }

    private function fill(Invoice $invoice, BillingAccount $account): void
    {
        $invoice->lines()->where('kind', '!=', InvoiceLineKind::Adjustment->value)->delete();
        $adjustments = $invoice->lines()->get();
        $position = 0;
        foreach ($this->computeLines($account, $invoice->month) as $line) {
            $invoice->lines()->create([...$line, 'position' => ++$position]);
        }
        foreach ($adjustments as $adjustment) {
            $adjustment->forceFill(['position' => ++$position])->save();
        }

        DB::table('billing_invoice_usage')->where('invoice_id', $invoice->getKey())->delete();
        $shares = DB::table('billing_usage_shares')
            ->where('billing_account_id', $account->getKey())
            ->whereDate('month', $invoice->month->toDateString())
            ->orderBy('organization_name')
            ->get();
        foreach ($shares as $share) {
            DB::table('billing_invoice_usage')->insert([
                'invoice_id' => $invoice->getKey(),
                'organization_uuid' => $share->organization_uuid,
                'organization_name' => $share->organization_name,
                'kind' => $share->kind,
                'count' => (int) $share->count,
            ]);
        }

        $this->totals($invoice, $account);
    }

    private function lockedDraft(Invoice $invoice): Invoice
    {
        $locked = Invoice::query()->whereKey($invoice->getKey())->lockForUpdate()->firstOrFail();
        abort_if($locked->isIssued(), 409, 'This invoice is issued and cannot change. Issue a credit note instead.');

        return $locked;
    }

    /** "1–15 Nov 2026", or "3 Nov 2026" for one day. */
    private static function period(CarbonImmutable $start, CarbonImmutable $stop): string
    {
        return $start->isSameDay($stop) ? $start->format('j M Y') : $start->format('j').'–'.$stop->format('j M Y');
    }
}
