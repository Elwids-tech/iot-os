<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Enums\InvoiceLineKind;
use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Enums\PriceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Models\InvoiceLine;
use App\Domain\Billing\Services\InvoiceDrafter;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Billing\Services\Prices;
use App\Domain\Billing\Services\Usage;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Drafting monthly invoices (spec 029 FR-031–FR-034, FR-038, SC-009): each day charged to
 * the assignment in force at 00:00 UTC, base prices prorated by day, overage priced per
 * assignment with data point blocks rounded up, trials at 0, prices from the month's own
 * set, drafts waiting for final usage, and every stored figure recomputable.
 */
final class InvoiceDraftingTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private BillingAccount $account;

    private Organization $organization;

    private BillingPlan $starter;

    private BillingPlan $larger;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->admin = User::factory()->create(['is_super_admin' => true]);
        $this->account = BillingAccount::factory()->create(['name' => 'Example Account']);
        $this->organization = Organization::factory()->forBillingAccount($this->account)->create(['name' => 'North plant']);
        $this->starter = BillingPlan::factory()->withAllowances(['alerts' => 3, 'data_points' => 1_000_000])->create(['name' => 'Plan A']);
        $this->larger = BillingPlan::factory()->withAllowances(['alerts' => 3, 'data_points' => 1_000_000])->create(['name' => 'Plan B']);

        // Prices set in September apply from October.
        $this->travelTo(CarbonImmutable::parse('2026-09-15 09:00', 'UTC'));
        $prices = app(Prices::class);
        $prices->setPlanPrices($this->starter, ['base_price' => 3100, 'alert_overage_price' => 7, 'data_point_overage_price' => 250, 'data_point_block_size' => 1_000_000], $this->admin);
        $prices->setPlanPrices($this->larger, ['base_price' => 6200, 'alert_overage_price' => 5, 'data_point_overage_price' => 200, 'data_point_block_size' => 1_000_000], $this->admin);
    }

    public function test_a_mid_month_plan_change_prorates_by_day_from_the_assignment_in_force_at_midnight(): void
    {
        $this->assign('2026-09-20 08:00', $this->starter);
        // Assigned mid-day: Plan A still has 10 October, Plan B starts charging on the 11th.
        $this->assign('2026-10-10 12:00', $this->larger);
        $invoice = $this->draftOctober();

        $base = $invoice->lines->where('kind', InvoiceLineKind::BasePrice)->values();
        $this->assertCount(2, $base);
        $this->assertSame(['Plan A · 1–10 Oct 2026 (10 of 31 days)', 10.0, 3100, 1000], [$base[0]->description, (float) $base[0]->quantity, $base[0]->unit_price, $base[0]->amount]);
        $this->assertSame(['Plan B · 11–31 Oct 2026 (21 of 31 days)', 21.0, 6200, 4200], [$base[1]->description, (float) $base[1]->quantity, $base[1]->unit_price, $base[1]->amount]);
        $this->assertSame(5200, $invoice->subtotal);
        $this->assertTrue($invoice->usage_incomplete === false && $invoice->drafted_by === null);
    }

    public function test_overage_is_priced_per_assignment_and_data_points_by_whole_blocks(): void
    {
        $this->assign('2026-09-20 08:00', $this->starter);
        $this->assign('2026-10-10 12:00', $this->larger);
        $usage = app(Usage::class);
        // Five alerts over Plan A's three, under Plan A.
        $usage->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-05 10:00', 'UTC'), 8);
        // 1,500,001 data points over the allowance under Plan B: two blocks.
        $usage->add($this->account, $this->organization, AllowanceKind::DataPoints, CarbonImmutable::parse('2026-10-20 10:00', 'UTC'), 2_500_001);
        $invoice = $this->draftOctober();

        $alerts = $invoice->lines->firstWhere('kind', InvoiceLineKind::AlertOverage);
        $this->assertSame(['Alert overage · Plan A · 5 alerts', 5.0, 7, 35], [$alerts->description, (float) $alerts->quantity, $alerts->unit_price, $alerts->amount]);
        $points = $invoice->lines->firstWhere('kind', InvoiceLineKind::DataPointOverage);
        $this->assertSame('Data point overage · Plan B · 1,500,001 data points in 2 blocks of 1,000,000', $points->description);
        $this->assertSame([2.0, 200, 400], [(float) $points->quantity, $points->unit_price, $points->amount]);
        $this->assertSame(1000 + 4200 + 35 + 400, $invoice->subtotal);
        // Each organization's usage is snapshotted with the invoice.
        $this->assertSame(
            [['North plant', 'alerts', 8], ['North plant', 'data_points', 2_500_001]],
            DB::table('billing_invoice_usage')->where('invoice_id', $invoice->id)->orderBy('kind')->get()
                ->map(fn (object $row): array => [$row->organization_name, $row->kind, (int) $row->count])->all(),
        );
    }

    public function test_trial_days_and_trial_overage_are_shown_at_zero(): void
    {
        $this->assign('2026-09-20 08:00', $this->starter, PlanAssignmentKind::Trial);
        app(Usage::class)->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-05 10:00', 'UTC'), 5);
        $invoice = $this->draftOctober();

        $trial = $invoice->lines->firstWhere('kind', InvoiceLineKind::Trial);
        $this->assertSame(['Plan A trial · 1–31 Oct 2026 (31 of 31 days)', 0], [$trial->description, $trial->amount]);
        $alerts = $invoice->lines->firstWhere('kind', InvoiceLineKind::AlertOverage);
        $this->assertSame([2.0, 0, 'Not charged during trial'], [(float) $alerts->quantity, $alerts->amount, $alerts->note]);
        $this->assertSame(0, $invoice->total);
    }

    public function test_a_plan_without_prices_is_free_and_a_quiet_month_still_has_its_base_price(): void
    {
        $free = BillingPlan::factory()->create(['name' => 'Unpriced']);
        $this->assign('2026-09-20 08:00', $free);
        $quiet = BillingAccount::factory()->create(['name' => 'Quiet Account']);
        $this->assign('2026-09-20 08:00', $this->starter, account: $quiet);
        $this->finalThrough('2026-11-01 00:00');
        $this->travelTo(CarbonImmutable::parse('2026-11-02 02:10', 'UTC'));
        $this->artisan('billing:draft-invoices')->assertSuccessful();

        $unpriced = Invoice::query()->where('billing_account_id', $this->account->id)->sole();
        $this->assertSame([0, 0], [$unpriced->lines()->sole()->amount, $unpriced->total]);
        $line = Invoice::query()->where('billing_account_id', $quiet->id)->sole()->lines()->sole();
        $this->assertSame([InvoiceLineKind::BasePrice, 3100], [$line->kind, $line->amount]);
    }

    public function test_a_price_change_during_the_month_applies_from_the_next_month_only(): void
    {
        $this->assign('2026-09-20 08:00', $this->starter);
        $this->travelTo(CarbonImmutable::parse('2026-10-12 09:00', 'UTC'));
        $from = app(Prices::class)->setPlanPrices($this->starter, ['base_price' => 9900, 'alert_overage_price' => 7, 'data_point_overage_price' => 250, 'data_point_block_size' => 1_000_000], $this->admin);
        app(Prices::class)->override($this->account, PriceKind::BasePrice, 1, 'Agreed rate', $this->admin);
        $this->assertSame('2026-11-01', $from->toDateString());

        $this->assertSame(3100, $this->draftOctober()->subtotal);
        // November uses both: the override wins over the new plan price.
        $this->assertSame(1, app(Prices::class)->for($this->account, $this->starter, CarbonImmutable::parse('2026-11-01', 'UTC'))['base_price']);
        $this->assertSame(9900, app(Prices::class)->planPrices($this->starter, CarbonImmutable::parse('2026-11-01', 'UTC'))['base_price']);
    }

    public function test_drafts_wait_for_final_usage_and_an_administrator_can_draft_anyway(): void
    {
        $this->assign('2026-09-20 08:00', $this->starter);
        $this->finalThrough('2026-10-31 23:00');
        $this->travelTo(CarbonImmutable::parse('2026-11-04 02:10', 'UTC'));
        $this->artisan('billing:draft-invoices')->assertSuccessful();
        $this->assertSame(0, Invoice::query()->count());

        $this->actingAs($this->admin, 'sanctum');
        $this->getJson('/api/v1/admin/billing/invoices/waiting?month=2026-10')
            ->assertOk()
            ->assertJsonPath('data.0.billing_account.uuid', $this->account->uuid)
            ->assertJsonPath('data.0.waiting_since', '2026-11-01T00:00:00+00:00')
            ->assertJsonPath('data.0.overdue', true);

        $this->postJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/invoices', ['month' => '2026-10'])->assertUnprocessable();
        $this->postJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/invoices', ['month' => '2026-12', 'note' => 'Too early'])->assertUnprocessable();
        $this->postJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/invoices', ['month' => '2026-10', 'note' => 'Runtime offline for maintenance'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.usage_incomplete', true)
            ->assertJsonPath('data.draft_note', 'Runtime offline for maintenance');
        $this->postJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/invoices', ['month' => '2026-10', 'note' => 'Again'])->assertConflict();
        $this->getJson('/api/v1/admin/billing/invoices/waiting?month=2026-10')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_recalculation_rebuilds_from_the_records_and_keeps_adjustments(): void
    {
        $this->assign('2026-09-20 08:00', $this->starter);
        $invoice = $this->draftOctober();
        $this->actingAs($this->admin, 'sanctum');
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/adjustments", ['description' => 'Goodwill credit', 'amount' => -500, 'note' => 'Outage on 3 October'])
            ->assertOk()
            ->assertJsonPath('data.subtotal', 2600);
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/adjustments", ['description' => 'Zero', 'amount' => 0, 'note' => 'n'])->assertUnprocessable();

        // Usage counted late, then a recalculation picks it up.
        app(Usage::class)->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-30 10:00', 'UTC'), 4);
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/recalculate")
            ->assertOk()
            ->assertJsonPath('data.subtotal', 3100 + 7 - 500)
            ->assertJsonPath('data.lines.2.kind', 'adjustment')
            ->assertJsonPath('data.lines.2.note', 'Outage on 3 October');

        $adjustment = $invoice->lines()->where('kind', 'adjustment')->sole();
        $this->deleteJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/adjustments/{$adjustment->id}")
            ->assertOk()
            ->assertJsonPath('data.subtotal', 3107);
    }

    public function test_stored_lines_and_totals_recompute_from_the_records(): void
    {
        $this->assign('2026-09-20 08:00', $this->starter);
        $this->assign('2026-10-10 12:00', $this->larger, PlanAssignmentKind::Trial);
        $this->assign('2026-10-20 00:00', $this->larger);
        app(Usage::class)->add($this->account, $this->organization, AllowanceKind::Alerts, CarbonImmutable::parse('2026-10-25 10:00', 'UTC'), 10);
        $invoice = $this->draftOctober();

        $computed = array_map(fn (array $line): array => [$line['kind']->value, $line['amount']], app(InvoiceDrafter::class)->computeLines($this->account, $invoice->month));
        $stored = $invoice->lines->map(fn (InvoiceLine $line): array => [$line->kind->value, $line->amount])->all();
        $this->assertSame($computed, $stored);
        $this->assertSame(['base_price', 'trial', 'base_price', 'alert_overage'], array_column($stored, 0));
        $this->assertSame($invoice->subtotal, (int) $invoice->lines->sum('amount'));
        $this->assertSame($invoice->total, $invoice->subtotal + $invoice->tax);
        $this->assertSame($invoice->amount_due, $invoice->total - $invoice->credit_applied);
    }

    private function assign(string $at, BillingPlan $plan, PlanAssignmentKind $kind = PlanAssignmentKind::Paid, ?BillingAccount $account = null): void
    {
        $this->travelTo(CarbonImmutable::parse($at, 'UTC'));
        app(PlanAssignments::class)->assign($account ?? $this->account, $plan, $this->admin, $kind);
    }

    private function finalThrough(string $at): void
    {
        DB::table('billing_usage_watermarks')->updateOrInsert(['source' => 'runtime'], ['final_through' => CarbonImmutable::parse($at, 'UTC'), 'reported_at' => now()]);
    }

    private function draftOctober(): Invoice
    {
        $this->finalThrough('2026-11-01 00:00');
        $this->travelTo(CarbonImmutable::parse('2026-11-02 02:10', 'UTC'));
        $this->artisan('billing:draft-invoices')->assertSuccessful();

        return Invoice::query()->where('billing_account_id', $this->account->id)->with('lines')->sole();
    }
}
