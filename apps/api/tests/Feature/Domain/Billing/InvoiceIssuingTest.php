<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Jobs\DeliverBillingEmail;
use App\Domain\Billing\Mail\InvoiceDocumentMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Services\InvoiceDrafter;
use App\Domain\Billing\Services\InvoiceIssuer;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Billing\Services\Prices;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * Issuing invoices and credit notes (spec 029 FR-034–FR-038, SC-007, SC-009): numbers
 * without gaps, fixed contents and snapshots, tax rounded half up, credit applied and
 * carried, emails once each, and owners seeing only their issued documents.
 */
final class InvoiceIssuingTest extends TestCase
{
    use ForksProcesses, RefreshDatabase;

    private User $admin;

    private User $owner;

    private Organization $acme;

    private BillingAccount $account;

    private BillingPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Queue::fake();
        $this->admin = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->account = $this->acme->billingAccount;
        $this->account->forceFill(['name' => 'Example Account', 'contact_email' => 'billing@example.com'])->save();
        $this->owner = User::factory()->create(['name' => 'Olive Owner', 'email' => 'olive@example.com']);
        $this->account->owners()->attach($this->owner->id, ['created_at' => now()]);
        $this->plan = BillingPlan::factory()->create(['name' => 'Plan A']);

        $this->travelTo(CarbonImmutable::parse('2026-09-15 09:00', 'UTC'));
        app(Prices::class)->setPlanPrices($this->plan, ['base_price' => 333, 'alert_overage_price' => 0, 'data_point_overage_price' => 0, 'data_point_block_size' => 1_000_000], $this->admin);
        app(PlanAssignments::class)->assign($this->account, $this->plan, $this->admin);
        DB::table('billing_usage_watermarks')->insert(['source' => 'runtime', 'final_through' => CarbonImmutable::parse('2026-11-01', 'UTC'), 'reported_at' => now()]);
        $this->travelTo(CarbonImmutable::parse('2026-11-02 10:00', 'UTC'));
        $this->actingAs($this->admin, 'sanctum');
    }

    public function test_settings_tax_and_billing_details_go_on_the_invoice_with_tax_rounded_half_up(): void
    {
        $settings = $this->getJson('/api/v1/admin/billing/settings')->assertOk()->assertJsonPath('data.currency', 'USD')->json('data');
        $this->putJson('/api/v1/admin/billing/settings', [...$settings, 'legal_name' => 'Example Operator Ltd', 'address' => "1 Example Street\nExample City", 'tax_registration_number' => 'OP-123'])
            ->assertOk()
            ->assertJsonPath('data.revision', 1);
        $this->putJson('/api/v1/admin/billing/settings', [...$settings, 'legal_name' => 'Stale'])->assertConflict();

        $rate = $this->postJson('/api/v1/admin/billing/tax-rates', ['name' => 'Sales tax', 'basis_points' => 1500])->assertCreated()->json('data');
        $this->postJson('/api/v1/admin/billing/tax-rates', ['name' => 'Sales tax', 'basis_points' => 10])->assertUnprocessable();
        $this->patchJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/billing-details', ['billing_address' => '2 Customer Road', 'tax_number' => 'CU-9', 'tax_rate_uuid' => $rate['uuid']])
            ->assertOk()
            ->assertJsonPath('data.billing_details.tax_rate.name', 'Sales tax');

        // 3.33 at 15% is 0.4995 of tax: 0.50.
        $invoice = $this->draft();
        $this->assertSame([333, 50, 383], [$invoice->subtotal, $invoice->tax, $invoice->total]);
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/issue")
            ->assertOk()
            ->assertJsonPath('data.number', 'INV-0001')
            ->assertJsonPath('data.status', 'issued')
            ->assertJsonPath('data.tax_rate_name', 'Sales tax')
            ->assertJsonPath('data.operator_details.legal_name', 'Example Operator Ltd')
            ->assertJsonPath('data.account_details.billing_address', '2 Customer Road')
            ->assertJsonPath('data.due_at', '2026-11-16T10:00:00+00:00')
            ->assertJsonPath('data.payment_status', 'pending');

        // Later changes leave the issued invoice as it was.
        $this->putJson('/api/v1/admin/billing/settings', [...$this->getJson('/api/v1/admin/billing/settings')->json('data'), 'legal_name' => 'Renamed Operator'])->assertOk();
        $this->patchJson('/api/v1/admin/billing/tax-rates/'.$rate['uuid'], ['basis_points' => 2000])->assertOk();
        $this->patchJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/billing-details', ['billing_address' => 'Moved', 'tax_number' => null, 'tax_rate_uuid' => null])->assertOk();
        $this->getJson("/api/v1/admin/billing/invoices/{$invoice->uuid}")
            ->assertJsonPath('data.operator_details.legal_name', 'Example Operator Ltd')
            ->assertJsonPath('data.account_details.billing_address', '2 Customer Road')
            ->assertJsonPath('data.tax_basis_points', 1500)
            ->assertJsonPath('data.tax', 50);

        $pdf = $this->get("/api/v1/admin/billing/invoices/{$invoice->uuid}.pdf")->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringStartsWith('%PDF', (string) $pdf->getContent());
        $csv = (string) $this->get("/api/v1/admin/billing/invoices/{$invoice->uuid}.csv")->assertOk()->getContent();
        $this->assertStringContainsString('invoice,INV-0001,month,2026-10,currency,USD', $csv);
        $this->assertStringContainsString('total,3.83', $csv);
    }

    public function test_issued_invoices_never_change_and_numbers_have_no_gaps(): void
    {
        $invoice = $this->draft();
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/issue")->assertOk();
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/issue")->assertConflict();
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/recalculate")->assertConflict();
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/adjustments", ['description' => 'Late', 'amount' => 100, 'note' => 'n'])->assertConflict();

        $issued = Invoice::query()->findOrFail($invoice->id);
        $this->expectException(LogicException::class);
        try {
            $issued->forceFill(['total' => 1])->save();
        } finally {
            // payment_status alone may change, and a draft for the next month takes the next number.
            $issued->refresh()->forceFill(['payment_status' => PaymentStatus::PaidOutside])->save();
            $this->travelTo(CarbonImmutable::parse('2026-12-02 10:00', 'UTC'));
            DB::table('billing_usage_watermarks')->update(['final_through' => CarbonImmutable::parse('2026-12-01', 'UTC')]);
            $next = app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-11-01', 'UTC'), null, null);
            $this->assertSame('INV-0002', app(InvoiceIssuer::class)->issue($next, $this->admin)->number);
        }
    }

    public function test_concurrent_issues_take_consecutive_numbers(): void
    {
        $this->skipUnlessForkable();
        $setup = $this->committedConnection();
        $now = now();
        $start = (int) $setup->table('billing_number_sequences')->where('name', 'invoice')->value('next');
        // The children see only committed rows: the seeded administrator is not.
        $actor = $setup->table('users')->insertGetId(['name' => 'Concurrent Admin', 'email' => 'concurrent-'.Str::lower(Str::random(8)).'@example.test', 'password' => 'x', 'created_at' => $now, 'updated_at' => $now]);
        $accounts = [];
        $invoices = [];
        foreach (range(1, 6) as $i) {
            $accounts[] = $account = $setup->table('billing_accounts')->insertGetId(['uuid' => (string) Str::uuid(), 'name' => 'Concurrent '.$i, 'created_at' => $now, 'updated_at' => $now]);
            $invoices[] = $setup->table('billing_invoices')->insertGetId([
                'uuid' => (string) Str::uuid(), 'billing_account_id' => $account, 'month' => '2026-10-01', 'status' => 'draft',
                'currency' => 'USD', 'payment_status' => 'pending', 'drafted_at' => $now, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        try {
            $numbers = $this->inForkedProcesses(count($invoices), function (int $index, callable $ready) use ($invoices, $actor): string {
                $ready();

                return (string) app(InvoiceIssuer::class)->issue(Invoice::query()->findOrFail($invoices[$index]), User::query()->findOrFail($actor))->number;
            });

            sort($numbers);
            $this->assertSame(array_map(fn (int $n): string => 'INV-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT), range($start, $start + 5)), $numbers);
        } finally {
            $uuids = $setup->table('billing_invoices')->whereIn('id', $invoices)->pluck('uuid');
            $setup->table('activity_log')->whereIn('subject_uuid', $uuids)->delete();
            $setup->table('billing_invoice_lines')->whereIn('invoice_id', $invoices)->delete();
            $setup->table('billing_invoices')->whereIn('id', $invoices)->delete();
            $setup->table('billing_accounts')->whereIn('id', $accounts)->delete();
            $setup->table('users')->where('id', $actor)->delete();
            $setup->table('billing_number_sequences')->where('name', 'invoice')->update(['next' => $start]);
            $setup->disconnect();
        }
    }

    public function test_credit_notes_reduce_what_is_owed_and_carry_the_rest_to_the_next_invoice(): void
    {
        $invoice = $this->issued();
        $this->assertSame([333, PaymentStatus::Pending], [$invoice->amount_due, $invoice->payment_status]);

        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/credit-notes", ['amount' => 334, 'reason' => 'Too much'])->assertUnprocessable()->assertJsonValidationErrors('amount');
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/credit-notes", ['amount' => 100, 'reason' => 'Partial outage'])
            ->assertCreated()
            ->assertJsonPath('data.number', 'CN-0001')
            ->assertJsonPath('data.applied', 100);
        $this->getJson("/api/v1/admin/billing/invoices/{$invoice->uuid}")->assertJsonPath('data.outstanding', 233)->assertJsonPath('data.payment_status', 'pending');

        // The rest settles it, and nothing more can be credited.
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/credit-notes", ['amount' => 233, 'reason' => 'Rest'])->assertCreated()->assertJsonPath('data.applied', 233);
        $this->getJson("/api/v1/admin/billing/invoices/{$invoice->uuid}")->assertJsonPath('data.outstanding', 0)->assertJsonPath('data.payment_status', 'credited');
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/credit-notes", ['amount' => 1, 'reason' => 'More'])->assertUnprocessable();

        // On a paid invoice the whole credit is carried to the next one, after tax.
        $this->travelTo(CarbonImmutable::parse('2026-12-02 10:00', 'UTC'));
        DB::table('billing_usage_watermarks')->update(['final_through' => CarbonImmutable::parse('2026-12-01', 'UTC')]);
        $november = app(InvoiceIssuer::class)->issue(app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-11-01', 'UTC'), null, null), $this->admin);
        $november->forceFill(['payment_status' => PaymentStatus::PaidOutside])->save();
        $this->postJson("/api/v1/admin/billing/invoices/{$november->uuid}/credit-notes", ['amount' => 300, 'reason' => 'Refund as credit'])
            ->assertCreated()
            ->assertJsonPath('data.number', 'CN-0003')
            ->assertJsonPath('data.applied', 0);

        $this->travelTo(CarbonImmutable::parse('2027-01-02 10:00', 'UTC'));
        DB::table('billing_usage_watermarks')->update(['final_through' => CarbonImmutable::parse('2027-01-01', 'UTC')]);
        $december = app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-12-01', 'UTC'), null, null);
        $credit = $december->lines()->where('kind', 'credit')->sole();
        $this->assertSame(['Credit from CN-0003', -300, 300, 33], [$credit->description, $credit->amount, $december->credit_applied, $december->amount_due]);
        $issued = app(InvoiceIssuer::class)->issue($december, $this->admin);
        $this->assertSame([300, 33], [$issued->credit_applied, $issued->amount_due]);
        $this->assertSame(0, app(InvoiceDrafter::class)->creditBalance($this->account));
    }

    public function test_an_invoice_with_nothing_to_pay_is_paid_when_issued(): void
    {
        $this->putJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/prices/base_price', ['value' => 0, 'note' => 'Free'])
            ->assertOk()
            ->assertJsonPath('effective_from', '2026-12-01');
        $this->travelTo(CarbonImmutable::parse('2027-01-02 10:00', 'UTC'));
        DB::table('billing_usage_watermarks')->update(['final_through' => CarbonImmutable::parse('2027-01-01', 'UTC')]);
        $invoice = app(InvoiceIssuer::class)->issue(app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-12-01', 'UTC'), null, null), $this->admin);

        $this->assertSame([0, PaymentStatus::Paid], [$invoice->amount_due, $invoice->payment_status]);
    }

    public function test_the_billing_contact_and_each_owner_get_one_email_each(): void
    {
        $second = User::factory()->create(['email' => 'billing@example.com']);
        $this->account->owners()->attach($second->id, ['created_at' => now()]);
        $invoice = $this->issued();

        // The contact is also an owner here, so it is emailed once, as an owner.
        Queue::assertPushed(DeliverBillingEmail::class, 2);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->userId === $this->owner->id && $job->mail instanceof InvoiceDocumentMail && $job->mail->number === 'INV-0001');
        $this->assertSame(1, DB::table('billing_notices')->where('kind', 'invoice_issued')->where('key', 'invoice:'.$invoice->uuid)->count());

        $this->account->owners()->detach($second->id);
        $this->postJson("/api/v1/admin/billing/invoices/{$invoice->uuid}/credit-notes", ['amount' => 10, 'reason' => 'Sorry'])->assertCreated();
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->userId === null && $job->address === 'billing@example.com' && $job->mail->document === 'credit_note');
        Queue::assertPushed(DeliverBillingEmail::class, 4);

        $mail = InvoiceDocumentMail::forInvoice($invoice->refresh(), $this->account);
        $this->assertSame('Invoice INV-0001 for October 2026: Example Account', $mail->envelope()->subject);
        $this->assertSame('INV-0001.pdf', $mail->attachments()[0]->as);
    }

    public function test_owners_see_their_issued_invoices_and_prices_only(): void
    {
        $draft = $this->draft();
        $this->actingAs($this->owner, 'sanctum');
        $this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices')->assertOk()->assertJsonCount(0, 'data.invoices');
        $this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices/'.$draft->uuid)->assertNotFound();
        $this->get('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices/'.$draft->uuid.'.pdf')->assertNotFound();

        $this->actingAs($this->admin, 'sanctum');
        $this->postJson("/api/v1/admin/billing/invoices/{$draft->uuid}/adjustments", ['description' => 'Goodwill', 'amount' => -33, 'note' => 'Internal reason'])->assertOk();
        $this->postJson("/api/v1/admin/billing/invoices/{$draft->uuid}/issue")->assertOk();

        $this->actingAs($this->owner, 'sanctum');
        $this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices')
            ->assertOk()
            ->assertJsonPath('data.invoices.0.number', 'INV-0001')
            ->assertJsonPath('data.invoices.0.total', 300);
        $detail = $this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices/'.$draft->uuid)
            ->assertOk()
            ->assertJsonPath('data.lines.1.description', 'Goodwill')
            ->assertJsonPath('data.lines.1.note', null);
        $this->assertStringNotContainsString('Internal reason', (string) $detail->getContent());
        $this->get('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices/'.$draft->uuid.'.csv')->assertOk();
        $this->getJson('/api/v1/billing-accounts')
            ->assertOk()
            ->assertJsonPath('data.0.prices.current.base_price', 333)
            ->assertJsonPath('data.0.prices.currency', 'USD')
            ->assertJsonPath('data.0.latest_invoice.number', 'INV-0001');

        // Anyone else: another person's account is 404, and a member's usage carries no prices.
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->actingAs($member, 'sanctum');
        $this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices')->assertNotFound();
        $this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/invoices/'.$draft->uuid)->assertNotFound();
        $this->getJson('/api/v1/admin/billing/invoices/'.$draft->uuid)->assertForbidden();
        $manager = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $usage = (string) $this->actingAs($manager, 'sanctum')->getJson('/api/v1/organizations/'.$this->acme->uuid.'/usage')->assertOk()->getContent();
        $this->assertStringNotContainsString('price', $usage);
        $this->assertStringNotContainsString('invoice', $usage);
    }

    public function test_an_account_with_issued_invoices_cannot_be_deleted_and_its_drafts_go_with_it_otherwise(): void
    {
        $issued = $this->issued();
        $this->acme->forceFill(['billing_account_id' => BillingAccount::factory()->create()->id])->save();
        $this->deleteJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)->assertConflict()->assertJsonPath('message', 'This billing account has issued invoices, so it cannot be deleted.');
        $this->assertNotNull($issued->fresh());

        $other = BillingAccount::factory()->create(['name' => 'Draft only']);
        app(PlanAssignments::class)->assign($other, $this->plan, $this->admin);
        $draft = app(InvoiceDrafter::class)->draft($other, CarbonImmutable::parse('2026-11-01', 'UTC'), $this->admin, 'Early');
        $this->deleteJson('/api/v1/admin/billing-accounts/'.$other->uuid)->assertNoContent();
        $this->assertNull(Invoice::query()->find($draft->id));
    }

    private function draft(): Invoice
    {
        return app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-10-01', 'UTC'), null, null);
    }

    private function issued(): Invoice
    {
        return app(InvoiceIssuer::class)->issue($this->draft(), $this->admin);
    }
}
