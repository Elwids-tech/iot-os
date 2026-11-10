<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Enums\InvoiceLineKind;
use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Jobs\DeliverBillingEmail;
use App\Domain\Billing\Mail\TrialMail;
use App\Domain\Billing\Mail\UsageThresholdMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\InvoiceDrafter;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Billing\Services\Prices;
use App\Domain\Billing\Services\Trials;
use App\Domain\Billing\Services\Usage;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Trials (spec 029 US8, FR-046–FR-051, SC-008, SC-013): limited and open-ended trials
 * with the plan's limits and warnings, invoiced at 0; the card rule at the end; reminders
 * 7 days and 1 day before, once each; changes, conversion and the list filters.
 */
final class TrialsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $owner;

    private BillingAccount $account;

    private Organization $organization;

    private BillingPlan $planA;

    private BillingPlan $larger;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        // Prices set in September apply from October.
        $this->travelTo(CarbonImmutable::parse('2026-09-15 09:00', 'UTC'));
        $this->admin = User::factory()->create(['name' => 'Platform Admin', 'is_super_admin' => true]);
        $this->owner = User::factory()->create(['name' => 'Olive Owner', 'email' => 'olive@example.com']);
        $this->account = BillingAccount::factory()->create(['name' => 'Example Account']);
        $this->account->owners()->attach($this->owner->id, ['created_at' => now()]);
        $this->organization = Organization::factory()->forBillingAccount($this->account)->create(['name' => 'North plant']);
        $this->planA = BillingPlan::factory()->withAllowances(['alerts' => 3, 'devices' => 5])->create(['name' => 'Plan A']);
        $this->larger = BillingPlan::factory()->withAllowances(['alerts' => 10, 'devices' => 20])->create(['name' => 'Plan B']);

        $prices = app(Prices::class);
        $prices->setPlanPrices($this->planA, ['base_price' => 3100, 'alert_overage_price' => 7, 'data_point_overage_price' => 0, 'data_point_block_size' => 1_000_000], $this->admin);
        $prices->setPlanPrices($this->larger, ['base_price' => 6200, 'alert_overage_price' => 5, 'data_point_overage_price' => 0, 'data_point_block_size' => 1_000_000], $this->admin);
    }

    public function test_limited_and_open_ended_trials_start_on_the_plan_and_owners_see_them(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-01 09:00', 'UTC'));
        app(PlanAssignments::class)->assign($this->account, $this->planA, $this->admin);

        // No plan given: the account's own. A 30-day trial runs until 30 October.
        $this->trial('POST', '', ['ends_at' => '2026-10-31T00:00:00Z'])
            ->assertOk()
            ->assertJsonPath('data.plan_assignment.kind', 'trial')
            ->assertJsonPath('data.plan_assignment.plan.name', 'Plan A')
            ->assertJsonPath('data.plan_assignment.trial_ends_at', '2026-10-31T00:00:00+00:00')
            ->assertJsonPath('data.history.0.changes.0', ['field' => 'trial', 'from' => 'none', 'to' => 'Plan A until 30 Oct 2026']);
        // At most one open trial.
        $this->trial('POST', '', ['ends_at' => null])->assertStatus(409);

        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/billing-accounts')
            ->assertOk()
            ->assertJsonPath('data.0.plan.kind', 'trial')
            ->assertJsonPath('data.0.plan.trial_ends_at', '2026-10-31T00:00:00+00:00');

        // An open-ended trial on another account, on another plan.
        $partner = BillingAccount::factory()->create(['name' => 'Research Partner']);
        $this->trial('POST', '', ['plan_uuid' => $this->larger->uuid, 'ends_at' => null], $partner)
            ->assertOk()
            ->assertJsonPath('data.plan_assignment.kind', 'trial')
            ->assertJsonPath('data.plan_assignment.plan.name', 'Plan B')
            ->assertJsonPath('data.plan_assignment.trial_ends_at', null)
            ->assertJsonPath('data.history.0.changes.0.to', 'Plan B, no end date');

        // Without a plan, or with an end in the past, nothing starts.
        $bare = BillingAccount::factory()->create();
        $this->trial('POST', '', ['ends_at' => null], $bare)->assertUnprocessable()->assertJsonValidationErrors('plan_uuid');
        $this->trial('POST', '', ['plan_uuid' => $this->planA->uuid, 'ends_at' => '2026-09-30T00:00:00Z'], $bare)->assertUnprocessable()->assertJsonValidationErrors('ends_at');
        $this->assertSame(0, PlanAssignment::query()->where('billing_account_id', $bare->id)->count());

        // Only platform administrators manage trials.
        $this->actingAs($this->owner, 'sanctum')
            ->postJson('/api/v1/admin/billing-accounts/'.$bare->uuid.'/trial', ['plan_uuid' => $this->planA->uuid, 'ends_at' => null])
            ->assertForbidden();
    }

    public function test_the_plans_limits_usage_and_warnings_apply_during_a_trial(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-01 09:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, null, $this->admin);

        $devices = app(Allowances::class)->resolve($this->account, AllowanceKind::Devices);
        $this->assertSame([5, 'plan'], [$devices->value, $devices->source]);
        app(Usage::class)->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::now(), 3);

        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof UsageThresholdMail && $job->mail->percent === 100);
        $this->assertSame(3, (int) DB::table('billing_usage')->where('billing_account_id', $this->account->id)->value('count'));
    }

    public function test_a_trial_ending_mid_month_is_charged_from_the_next_day_and_no_trial_day_is_charged(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-20 08:00', 'UTC'));
        // The last trial day is 10 October; a card is saved, so it continues on the plan.
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-11 00:00', 'UTC'), $this->admin);
        $this->account->forceFill(['pm_type' => 'visa', 'pm_last_four' => '4242', 'pm_expires' => '2030-12'])->save();
        $usage = app(Usage::class);
        // Five alerts over the allowance during the trial.
        $usage->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-05 10:00', 'UTC'), 8);

        // The job runs late; the trial still ends at its end date.
        $this->travelTo(CarbonImmutable::parse('2026-10-11 06:00', 'UTC'));
        $this->artisan('billing:end-trials')->expectsOutput('Ended 1 trials and sent 0 trial reminders.')->assertSuccessful();
        $paid = app(PlanAssignments::class)->current($this->account);
        $this->assertSame([PlanAssignmentKind::Paid, 'Plan A', '2026-10-11 00:00:00'], [$paid->kind, $paid->plan->name, $paid->started_at->utc()->format('Y-m-d H:i:s')]);
        $this->assertSame('trial_reached_end', PlanAssignment::query()->where('kind', 'trial')->sole()->end_reason);
        // Two alerts over the allowance after the trial are charged.
        $usage->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-20 10:00', 'UTC'), 2);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof TrialMail
            && $job->mail->kind === 'ended' && $job->mail->charged && $job->mail->lastDay === '10 October 2026' && $job->mail->card === 'Visa ending 4242');

        $invoice = $this->draftOctober();
        $trial = $invoice->lines->firstWhere('kind', InvoiceLineKind::Trial);
        $this->assertSame(['Plan A trial · 1–10 Oct 2026 · 10 of 31 days, not charged', 0], [$trial->description, $trial->amount]);
        $base = $invoice->lines->firstWhere('kind', InvoiceLineKind::BasePrice);
        $this->assertSame(['Plan A · 11–31 Oct 2026 · 21 of 31 days at 31.00 a month', 2100], [$base->description, $base->amount]);
        $alerts = $invoice->lines->where('kind', InvoiceLineKind::AlertOverage)->values();
        $this->assertSame([[5.0, 0, 'Not charged during trial'], [2.0, 14, null]], $alerts->map(fn ($line): array => [(float) $line->quantity, $line->amount, $line->note])->all());
        $this->assertSame(2100 + 14, $invoice->subtotal);
    }

    public function test_overage_counted_after_a_trials_end_before_the_hourly_run_ends_it_first_and_is_charged(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-20 08:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-21 00:00', 'UTC'), $this->admin);
        $this->account->forceFill(['pm_type' => 'visa', 'pm_last_four' => '4242', 'pm_expires' => '2030-12'])->save();
        $usage = app(Usage::class);
        // One alert over the allowance on the trial's last day.
        $usage->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-20 23:58', 'UTC'), 4);

        // Two minutes after the end, before the hourly run at 00:05: the alert ends the trial first.
        $this->travelTo(CarbonImmutable::parse('2026-10-21 00:02', 'UTC'));
        $usage->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::now(), 1);
        $paid = app(PlanAssignments::class)->current($this->account);
        $this->assertSame([PlanAssignmentKind::Paid, '2026-10-21 00:00:00'], [$paid->kind, $paid->started_at->utc()->format('Y-m-d H:i:s')]);
        $this->assertSame('trial_reached_end', PlanAssignment::query()->where('kind', 'trial')->sole()->end_reason);
        // The hourly run finds nothing left to end.
        $this->travelTo(CarbonImmutable::parse('2026-10-21 00:05', 'UTC'));
        $this->artisan('billing:end-trials')->expectsOutput('Ended 0 trials and sent 0 trial reminders.')->assertSuccessful();

        $invoice = $this->draftOctober();
        $this->assertSame(
            [[1.0, 0, 'Not charged during trial'], [1.0, 7, null]],
            $invoice->lines->where('kind', InvoiceLineKind::AlertOverage)->map(fn ($line): array => [(float) $line->quantity, $line->amount, $line->note])->values()->all(),
        );
    }

    public function test_drafting_ends_a_trial_past_its_end_that_the_hourly_run_missed_and_charges_the_days_after(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-20 08:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-21 00:00', 'UTC'), $this->admin);
        $this->account->forceFill(['pm_type' => 'visa', 'pm_last_four' => '4242', 'pm_expires' => '2030-12'])->save();

        // The scheduler was down: no hourly run ended the trial before the draft.
        $invoice = $this->draftOctober();

        $this->assertSame('trial_reached_end', PlanAssignment::query()->where('kind', 'trial')->sole()->end_reason);
        $this->assertSame(
            [['trial', 0, 20], ['base_price', 1100, 11]],
            $invoice->lines->whereIn('kind', [InvoiceLineKind::Trial, InvoiceLineKind::BasePrice])
                ->map(fn ($line): array => [$line->kind->value, $line->amount, (int) $line->quantity])->values()->all(),
        );
    }

    public function test_a_draft_calculated_before_its_trial_ended_is_issued_only_once_recalculated(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-20 08:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-21 00:00', 'UTC'), $this->admin);
        // A preview of the running month, drafted while the trial still ran.
        $this->travelTo(CarbonImmutable::parse('2026-10-15 10:00', 'UTC'));
        $draft = app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-10-01', 'UTC'), $this->admin, null);
        // The hourly run ends the trial, with a card saved, so the rest of October is paid.
        $this->account->forceFill(['pm_type' => 'visa', 'pm_last_four' => '4242', 'pm_expires' => '2030-12'])->save();
        $this->travelTo(CarbonImmutable::parse('2026-10-21 00:05', 'UTC'));
        $this->artisan('billing:end-trials')->assertSuccessful();

        $this->travelTo(CarbonImmutable::parse('2026-11-02 10:00', 'UTC'));
        $this->actingAs($this->admin, 'sanctum');
        $refused = "October 2026's records changed since this draft was calculated. Recalculate the draft, check it, then issue it.";
        $this->postJson("/api/v1/admin/billing/invoices/{$draft->uuid}/issue")->assertConflict()->assertJsonPath('message', $refused);
        // Asking again changes nothing until it is recalculated.
        $this->postJson("/api/v1/admin/billing/invoices/{$draft->uuid}/issue")->assertConflict()->assertJsonPath('message', $refused);

        $this->postJson("/api/v1/admin/billing/invoices/{$draft->uuid}/recalculate")->assertOk();
        $this->postJson("/api/v1/admin/billing/invoices/{$draft->uuid}/issue")->assertOk()->assertJsonPath('data.status', 'issued');
        $this->assertSame(
            [['trial', 0, 20], ['base_price', 1100, 11]],
            $draft->refresh()->lines->whereIn('kind', [InvoiceLineKind::Trial, InvoiceLineKind::BasePrice])
                ->map(fn ($line): array => [$line->kind->value, $line->amount, (int) $line->quantity])->values()->all(),
        );
    }

    public function test_issuing_ends_a_trial_past_its_end_before_checking_the_draft(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-20 08:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-21 00:00', 'UTC'), $this->admin);
        $this->travelTo(CarbonImmutable::parse('2026-10-15 10:00', 'UTC'));
        $draft = app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-10-01', 'UTC'), $this->admin, null);

        // No hourly run since: issuing ends the trial, then finds the draft out of date.
        $this->travelTo(CarbonImmutable::parse('2026-11-02 10:00', 'UTC'));
        $this->actingAs($this->admin, 'sanctum')->postJson("/api/v1/admin/billing/invoices/{$draft->uuid}/issue")->assertConflict();
        $this->assertSame('trial_reached_end', PlanAssignment::query()->where('kind', 'trial')->sole()->end_reason);
    }

    public function test_a_card_saved_after_the_end_but_before_the_run_is_charged_from_the_next_day(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-20 08:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-21 00:00', 'UTC'), $this->admin);
        // The trial ended at 00:00; the owner saves a card at 00:03, before the 00:05 run.
        $this->travelTo(CarbonImmutable::parse('2026-10-21 00:03', 'UTC'));
        $this->account->forceFill(['pm_type' => 'visa', 'pm_last_four' => '4242', 'pm_expires' => '2030-12', 'pm_saved_at' => now()])->save();
        $this->travelTo(CarbonImmutable::parse('2026-10-21 00:05', 'UTC'));
        $this->artisan('billing:end-trials')->assertSuccessful();

        $this->assertSame(
            [['trial', '2026-10-21 00:00', 'trial_reached_end'], ['trial_unpaid', '2026-10-21 00:03', 'payment_method_added'], ['paid', null, null]],
            PlanAssignment::query()->where('billing_account_id', $this->account->id)->orderBy('id')->get()
                ->map(fn (PlanAssignment $assignment): array => [$assignment->kind->value, $assignment->ended_at?->utc()->format('Y-m-d H:i'), $assignment->end_reason])->all(),
        );
        $this->assertSame(1, DB::table('billing_notices')->where('kind', 'trial_ended')->count());

        $invoice = $this->draftOctober();
        $this->assertSame(
            [['trial', 0, 20], ['trial', 0, 1], ['base_price', 1000, 10]],
            $invoice->lines->whereIn('kind', [InvoiceLineKind::Trial, InvoiceLineKind::BasePrice])
                ->map(fn ($line): array => [$line->kind->value, $line->amount, (int) $line->quantity])->values()->all(),
        );
    }

    public function test_a_limited_trial_is_not_ended_by_usage_within_the_allowance(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-20 08:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-21 00:00', 'UTC'), $this->admin);

        $this->travelTo(CarbonImmutable::parse('2026-10-21 00:02', 'UTC'));
        app(Usage::class)->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::now(), 1);

        $this->assertSame(PlanAssignmentKind::Trial, app(PlanAssignments::class)->current($this->account)->kind);
    }

    public function test_a_trial_ended_without_a_card_is_flagged_uncharged_until_a_card_is_saved(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-30 09:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-11 00:00', 'UTC'), $this->admin);

        $this->travelTo(CarbonImmutable::parse('2026-10-11 00:05', 'UTC'));
        $this->artisan('billing:end-trials')->assertSuccessful();
        $this->assertSame(PlanAssignmentKind::TrialUnpaid, app(PlanAssignments::class)->current($this->account)->kind);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof TrialMail && $job->mail->kind === 'ended' && ! $job->mail->charged);
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/admin/billing-accounts?trial=ended_unpaid')
            ->assertOk()
            ->assertJsonPath('data.0.uuid', $this->account->uuid)
            ->assertJsonPath('data.0.plan.kind', 'trial_unpaid');

        // A card saved on 20 October: charged from the 21st, overage included.
        $this->travelTo(CarbonImmutable::parse('2026-10-20 15:00', 'UTC'));
        $this->account->forceFill(['pm_type' => 'visa', 'pm_last_four' => '4242'])->save();
        app(Trials::class)->paymentMethodAdded($this->account);
        $usage = app(Usage::class);
        $usage->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-20 16:00', 'UTC'), 5);
        $usage->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-21 01:00', 'UTC'), 1);
        $paid = app(PlanAssignments::class)->current($this->account);
        $this->assertSame([PlanAssignmentKind::Paid, 'payment_method_added'], [$paid->kind, PlanAssignment::query()->where('kind', 'trial_unpaid')->sole()->end_reason]);
        $this->getJson('/api/v1/admin/billing-accounts?trial=ended_unpaid')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)
            ->assertJsonPath('data.history.0.changes.0', ['field' => 'trial', 'from' => 'Plan A, ended without a payment method', 'to' => 'paid from 21 Oct 2026']);

        $invoice = $this->draftOctober();
        $this->assertSame(
            [['trial', 0, 10], ['trial', 0, 10], ['base_price', 1100, 11]],
            $invoice->lines->whereIn('kind', [InvoiceLineKind::Trial, InvoiceLineKind::BasePrice])
                ->map(fn ($line): array => [$line->kind->value, $line->amount, (int) $line->quantity])->values()->all(),
        );
        // Two alerts over the allowance on the 20th are not charged; the one on the 21st is.
        $this->assertSame(
            [[2.0, 0, 'Not charged during trial'], [1.0, 7, null]],
            $invoice->lines->where('kind', InvoiceLineKind::AlertOverage)->map(fn ($line): array => [(float) $line->quantity, $line->amount, $line->note])->values()->all(),
        );
    }

    public function test_trials_are_checked_hourly_so_one_that_ended_during_an_outage_ends_soon_after(): void
    {
        $event = collect(app(Schedule::class)->events())->first(fn (Event $event): bool => str_contains((string) $event->command, 'billing:end-trials'));

        $this->assertSame('5 * * * *', $event?->expression);
    }

    public function test_a_plan_change_or_removal_during_a_trial_ends_it_audited_and_emailed(): void
    {
        $this->trial('POST', '', ['plan_uuid' => $this->planA->uuid, 'ends_at' => '2026-10-15T00:00:00Z'])->assertOk();

        // Moved to another plan during the trial.
        $this->actingAs($this->admin, 'sanctum')->putJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/plan', ['plan_uuid' => $this->larger->uuid])->assertOk();
        $ended = DB::table('activity_log')->where('event', 'billing_account.trial_ended')->latest('id')->first();
        $this->assertSame(['plan_changed', 'trial', 'paid'], [json_decode($ended->properties, true)['reason'], json_decode($ended->properties, true)['from'], json_decode($ended->properties, true)['to']]);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof TrialMail && $job->mail->kind === 'ended'
            && str_contains((string) $job->mail->content()->with['next'], 'moved to Plan B'));
        $changes = collect($this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)->assertOk()->json('data.history'))->pluck('changes')->flatten(1);
        $this->assertSame('ended by a plan change', $changes->firstWhere('field', 'trial')['to'] ?? null);

        // A new trial, then the plan is taken away.
        $this->trial('POST', '', ['ends_at' => '2026-10-15T00:00:00Z'])->assertOk();
        $this->putJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/plan', ['plan_uuid' => null])->assertOk();
        $removed = json_decode((string) DB::table('activity_log')->where('event', 'billing_account.trial_ended')->latest('id')->value('properties'), true);
        $this->assertSame(['plan_removed', null], [$removed['reason'], $removed['to']]);
        $this->assertSame(2, DB::table('billing_notices')->where('kind', 'trial_ended')->count());
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof TrialMail && $job->mail->removed
            && $job->mail->content()->with['next'] === 'The account is no longer on a plan.');
    }

    public function test_every_exit_from_a_trial_ended_without_a_card_and_a_deleted_accounts_trial_is_audited_without_an_email(): void
    {
        $unpaid = function (BillingAccount $account): void {
            app(Trials::class)->start($account, $this->planA, CarbonImmutable::now()->addDay(), $this->admin);
            $this->travel(2)->days();
            $this->artisan('billing:end-trials')->assertSuccessful();
            $this->assertSame(PlanAssignmentKind::TrialUnpaid, app(PlanAssignments::class)->current($account)->kind);
        };
        $ends = fn (): array => DB::table('activity_log')->where('event', 'billing_account.trial_ended')->orderBy('id')->get()
            ->map(fn (object $row): array => [json_decode($row->properties, true)['from'], json_decode($row->properties, true)['reason']])->all();

        // A plan change, then a new trial, each end a trial that ended without a card.
        $unpaid($this->account);
        $this->actingAs($this->admin, 'sanctum')->putJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/plan', ['plan_uuid' => $this->larger->uuid])->assertOk();
        $other = BillingAccount::factory()->ownedBy($this->owner)->create();
        $unpaid($other);
        app(Trials::class)->start($other, $this->planA, null, $this->admin);
        // Deleting an account on a trial.
        $this->actingAs($this->admin, 'sanctum')->deleteJson('/api/v1/admin/billing-accounts/'.$other->uuid)->assertNoContent();

        $this->assertSame([
            ['trial', 'trial_reached_end'], ['trial_unpaid', 'plan_changed'],
            ['trial', 'trial_reached_end'], ['trial_unpaid', 'trial_started'],
            ['trial', 'account_deleted'],
        ], $ends());
        // Only the two trials that reached their end emailed the owners.
        $this->assertSame(2, DB::table('billing_notices')->where('kind', 'trial_ended')->count());
        $changes = collect($this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)->assertOk()->json('data.history'))->pluck('changes')->flatten(1);
        $this->assertSame('ended by a plan change', $changes->where('field', 'trial')->first()['to'] ?? null);
    }

    public function test_owners_are_reminded_7_days_and_1_day_before_a_limited_trial_ends_once_each(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-01 09:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-31 00:00', 'UTC'), $this->admin);
        $open = BillingAccount::factory()->create();
        $open->owners()->attach($this->owner->id, ['created_at' => now()]);
        app(Trials::class)->start($open, $this->planA, null, $this->admin);

        $this->artisan('billing:end-trials', ['--now' => '2026-10-23 00:05'])->expectsOutput('Ended 0 trials and sent 0 trial reminders.');
        $this->artisan('billing:end-trials', ['--now' => '2026-10-24 00:05'])->expectsOutput('Ended 0 trials and sent 1 trial reminders.');
        $this->artisan('billing:end-trials', ['--now' => '2026-10-25 00:05'])->expectsOutput('Ended 0 trials and sent 0 trial reminders.');
        $this->artisan('billing:end-trials', ['--now' => '2026-10-30 00:05'])->expectsOutput('Ended 0 trials and sent 1 trial reminders.');
        $this->artisan('billing:end-trials', ['--now' => '2026-10-30 12:00'])->expectsOutput('Ended 0 trials and sent 0 trial reminders.');

        $reminders = DB::table('billing_notices')->where('kind', 'trial_reminder')->orderBy('key')->pluck('key')->all();
        $this->assertSame(["trial:{$this->account->uuid}:2026-10-31:1d", "trial:{$this->account->uuid}:2026-10-31:7d"], $reminders);
        // With no card saved, the owners are asked for one.
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof TrialMail
            && $job->mail->kind === 'reminder' && $job->mail->lastDay === '30 October 2026' && $job->mail->card === null);

        // Extended after both reminders: reminded again before the new end.
        $this->travelTo(CarbonImmutable::parse('2026-10-30 13:00', 'UTC'));
        app(Trials::class)->change($this->account, CarbonImmutable::parse('2026-11-14 00:00', 'UTC'), null, $this->admin);
        $this->artisan('billing:end-trials', ['--now' => '2026-11-07 00:05'])->expectsOutput('Ended 0 trials and sent 1 trial reminders.');
        // Moved to another plan with the same end: not reminded again.
        app(Trials::class)->change($this->account, CarbonImmutable::parse('2026-11-14 00:00', 'UTC'), $this->larger, $this->admin);
        $this->artisan('billing:end-trials', ['--now' => '2026-11-07 06:00'])->expectsOutput('Ended 0 trials and sent 0 trial reminders.');
    }

    public function test_reminders_sent_before_are_keyed_by_the_account(): void
    {
        $assignment = (string) Str::uuid();
        DB::table('billing_notices')->insert([
            ['billing_account_id' => $this->account->id, 'kind' => 'trial_reminder', 'key' => "trial:{$assignment}:2026-10-31:7d", 'sent_at' => now()],
            // Already keyed by the account, as `billing:end-trials` sends it now: kept.
            ['billing_account_id' => $this->account->id, 'kind' => 'trial_reminder', 'key' => "trial:{$this->account->uuid}:2026-10-31:1d", 'sent_at' => now()],
            // Sent under both keys: one stays.
            ['billing_account_id' => $this->account->id, 'kind' => 'trial_reminder', 'key' => "trial:{$this->account->uuid}:2026-11-30:1d", 'sent_at' => now()],
            ['billing_account_id' => $this->account->id, 'kind' => 'trial_reminder', 'key' => "trial:{$assignment}:2026-11-30:1d", 'sent_at' => now()],
        ]);

        // A second run (after a rollback) changes nothing.
        (require database_path('migrations/2026_11_18_000000_key_trial_reminders_by_account.php'))->up();
        (require database_path('migrations/2026_11_18_000000_key_trial_reminders_by_account.php'))->up();

        $this->assertSame(
            ["trial:{$this->account->uuid}:2026-10-31:1d", "trial:{$this->account->uuid}:2026-10-31:7d", "trial:{$this->account->uuid}:2026-11-30:1d"],
            DB::table('billing_notices')->where('kind', 'trial_reminder')->orderBy('key')->pluck('key')->all(),
        );
    }

    public function test_administrators_extend_shorten_move_end_and_convert_a_trial(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-01 09:00', 'UTC'));
        $this->trial('POST', '', ['plan_uuid' => $this->planA->uuid, 'ends_at' => '2026-10-31T00:00:00Z'])->assertOk();

        $this->trial('PATCH', '', ['ends_at' => '2026-11-15T00:00:00Z'])
            ->assertOk()
            ->assertJsonPath('data.plan_assignment.trial_ends_at', '2026-11-15T00:00:00+00:00')
            ->assertJsonPath('data.history.0.changes.0', ['field' => 'trial', 'from' => 'Plan A until 30 Oct 2026', 'to' => 'Plan A until 14 Nov 2026']);
        $this->trial('PATCH', '', ['ends_at' => '2026-10-20T00:00:00Z'])->assertOk()->assertJsonPath('data.plan_assignment.trial_ends_at', '2026-10-20T00:00:00+00:00');
        // Moving to another plan keeps the history of which plan was in force when.
        $this->travelTo(CarbonImmutable::parse('2026-10-05 09:00', 'UTC'));
        $this->trial('PATCH', '', ['plan_uuid' => $this->larger->uuid, 'ends_at' => null])
            ->assertOk()
            ->assertJsonPath('data.plan_assignment.plan.name', 'Plan B')
            ->assertJsonPath('data.plan_assignment.trial_ends_at', null)
            ->assertJsonPath('data.history.0.changes.0.to', 'Plan B, no end date');
        $this->assertSame(['Plan A', 'Plan B'], PlanAssignment::query()->where('kind', 'trial')->orderBy('id')->with('plan')->get()->pluck('plan.name')->all());

        // "Was the account on a trial at instant X" (FR-048).
        $assignments = app(PlanAssignments::class);
        $this->assertSame(PlanAssignmentKind::Trial, $assignments->at($this->account, CarbonImmutable::parse('2026-10-02 00:00', 'UTC'))->kind);
        $this->assertNull($assignments->at($this->account, CarbonImmutable::parse('2026-09-30 00:00', 'UTC')));

        // Ending an open-ended trial follows the card rule: no card, so flagged.
        $this->travelTo(CarbonImmutable::parse('2026-10-08 09:00', 'UTC'));
        $this->trial('POST', '/end')
            ->assertOk()
            ->assertJsonPath('data.plan_assignment.kind', 'trial_unpaid')
            ->assertJsonPath('data.history.0.changes.0', ['field' => 'trial', 'from' => 'Plan B', 'to' => 'ended without a payment method']);
        $this->trial('POST', '/end')->assertStatus(409);
        $this->trial('PATCH', '', ['ends_at' => null])->assertStatus(409);

        // An administrator turns it into the paid plan; charged from the next day.
        $this->trial('POST', '/convert')
            ->assertOk()
            ->assertJsonPath('data.plan_assignment.kind', 'paid')
            ->assertJsonPath('data.plan_assignment.plan.name', 'Plan B')
            ->assertJsonPath('data.history.0.changes.0.to', 'paid from 9 Oct 2026');
        $this->trial('POST', '/convert')->assertStatus(409);
        $this->assertSame(
            ['billing_account.trial_started', 'billing_account.trial_changed', 'billing_account.trial_changed', 'billing_account.trial_changed', 'billing_account.trial_ended', 'billing_account.trial_ended'],
            DB::table('activity_log')->where('event', 'like', 'billing_account.trial_%')->orderBy('id')->pluck('event')->all(),
        );
        $this->assertSame([1, 1], [
            DB::table('activity_log')->where('event', 'billing_account.trial_ended')->whereNotNull('causer_id')->distinct()->count('causer_id'),
            DB::table('billing_notices')->where('kind', 'trial_ended')->count(),
        ]);
    }

    public function test_the_list_filters_trials_and_an_organization_can_start_on_one(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-01 09:00', 'UTC'));
        app(Trials::class)->start($this->account, $this->planA, CarbonImmutable::parse('2026-10-06 00:00', 'UTC'), $this->admin);
        $later = BillingAccount::factory()->create(['name' => 'Later Trial']);
        app(Trials::class)->start($later, $this->planA, CarbonImmutable::parse('2026-12-01 00:00', 'UTC'), $this->admin);
        $paid = BillingAccount::factory()->create(['name' => 'Paid Account']);
        app(PlanAssignments::class)->assign($paid, $this->planA, $this->admin);
        $this->actingAs($this->admin, 'sanctum');

        $names = fn (string $filter): array => collect($this->getJson('/api/v1/admin/billing-accounts?trial='.$filter)->assertOk()->json('data'))->pluck('name')->sort()->values()->all();
        $this->assertSame(['Example Account', 'Later Trial'], $names('active'));
        $this->assertSame(['Example Account'], $names('ending'));
        $this->assertSame([], $names('ended_unpaid'));
        $this->getJson('/api/v1/admin/billing-accounts?trial=soon')->assertUnprocessable();

        // A new organization's new billing account starts on a trial.
        $this->postJson('/api/v1/admin/organizations', [
            'name' => 'Prospect Works',
            'slug' => 'prospect-works',
            'new_billing_account' => ['name' => 'Prospect Works'],
            'trial' => ['plan_uuid' => $this->larger->uuid, 'ends_at' => '2026-10-31T00:00:00Z'],
        ])->assertCreated();
        $account = BillingAccount::query()->where('name', 'Prospect Works')->sole();
        $trial = app(PlanAssignments::class)->current($account);
        $this->assertSame([PlanAssignmentKind::Trial, 'Plan B', '2026-10-31'], [$trial->kind, $trial->plan->name, $trial->trial_ends_at->utc()->toDateString()]);
        // Not with an existing account, nor together with a plan.
        $this->postJson('/api/v1/admin/organizations', [
            'name' => 'Second Site',
            'slug' => 'second-site',
            'billing_account_uuid' => $account->uuid,
            'trial' => ['plan_uuid' => $this->larger->uuid, 'ends_at' => null],
        ])->assertUnprocessable()->assertJsonValidationErrors('trial');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function trial(string $method, string $path, array $body = [], ?BillingAccount $account = null): TestResponse
    {
        return $this->actingAs($this->admin, 'sanctum')
            ->json($method, '/api/v1/admin/billing-accounts/'.($account ?? $this->account)->uuid.'/trial'.$path, $body);
    }

    private function draftOctober(): Invoice
    {
        DB::table('billing_usage_watermarks')->updateOrInsert(['source' => 'runtime'], ['final_through' => CarbonImmutable::parse('2026-11-01 00:00', 'UTC'), 'reported_at' => now()]);
        $this->travelTo(CarbonImmutable::parse('2026-11-02 02:10', 'UTC'));
        $this->artisan('billing:draft-invoices')->assertSuccessful();

        return Invoice::query()->where('billing_account_id', $this->account->id)->whereDate('month', '2026-10-01')->with('lines')->sole();
    }
}
