<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Jobs\ChargeInvoice;
use App\Domain\Billing\Jobs\DeliverBillingEmail;
use App\Domain\Billing\Mail\PaymentMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Models\Payment;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\InvoiceDrafter;
use App\Domain\Billing\Services\InvoiceIssuer;
use App\Domain\Billing\Services\Payments;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Billing\Services\Prices;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Card payments through Stripe (spec 029 US7, contracts/stripe-webhooks.md, SC-010,
 * SC-011), with Stripe's HTTP client faked: cards saved on Stripe's page, charges on
 * issue with an idempotency key per attempt, signed events applied once and only
 * forward, reminders and retries, past due without restrictions, payments recorded by
 * hand, and payments switched off.
 */
final class StripePaymentsTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'whsec_test_only';

    private FakeStripe $stripe;

    private User $admin;

    private User $owner;

    private Organization $acme;

    private BillingAccount $account;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Queue::fake();
        config(['cashier.secret' => 'sk_test_only', 'cashier.webhook.secret' => self::SECRET]);
        $this->stripe = FakeStripe::install();
        $this->admin = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->account = $this->acme->billingAccount;
        $this->account->forceFill(['name' => 'Example Account', 'contact_email' => null])->save();
        $this->owner = User::factory()->create(['name' => 'Olive Owner', 'email' => 'olive@example.com']);
        $this->account->owners()->attach($this->owner->id, ['created_at' => now()]);
        $plan = BillingPlan::factory()->create(['name' => 'Plan A']);

        $this->travelTo(CarbonImmutable::parse('2026-09-15 09:00', 'UTC'));
        app(Prices::class)->setPlanPrices($plan, ['base_price' => 333, 'alert_overage_price' => 0, 'data_point_overage_price' => 0, 'data_point_block_size' => 1_000_000], $this->admin);
        app(PlanAssignments::class)->assign($this->account, $plan, $this->admin);
        DB::table('billing_usage_watermarks')->insert(['source' => 'runtime', 'final_through' => CarbonImmutable::parse('2026-11-01', 'UTC'), 'reported_at' => now()]);
        $this->travelTo(CarbonImmutable::parse('2026-11-02 10:00', 'UTC'));
    }

    protected function tearDown(): void
    {
        FakeStripe::uninstall();
        parent::tearDown();
    }

    public function test_an_owner_saves_a_card_on_stripes_page_and_only_its_brand_last_four_and_expiry_are_kept(): void
    {
        $logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged): void {
            $logged[] = $event->message.json_encode($event->context);
        });
        $this->stripe
            ->on('POST', '/v1/customers', ['id' => 'cus_1', 'object' => 'customer'])
            ->on('POST', '/v1/checkout/sessions', ['id' => 'cs_1', 'object' => 'checkout.session', 'url' => 'https://checkout.stripe.test/c/cs_1'])
            ->on('GET', '/v1/customers/cus_1', ['id' => 'cus_1', 'object' => 'customer', 'invoice_settings' => ['default_payment_method' => 'pm_old']])
            ->on('GET', '/v1/setup_intents/seti_1', ['id' => 'seti_1', 'object' => 'setup_intent', 'payment_method' => [
                'id' => 'pm_new', 'object' => 'payment_method', 'type' => 'card', 'card' => ['brand' => 'visa', 'last4' => '4242', 'exp_month' => 12, 'exp_year' => 2030],
            ]])
            ->on('POST', '/v1/customers/cus_1', ['id' => 'cus_1', 'object' => 'customer'])
            ->on('POST', '/v1/payment_methods/pm_old/detach', ['id' => 'pm_old', 'object' => 'payment_method']);

        $this->actingAs($this->owner, 'sanctum')
            ->postJson($this->owned('/payment-method/checkout'))
            ->assertOk()
            ->assertJsonPath('data.url', 'https://checkout.stripe.test/c/cs_1');
        $session = $this->stripe->sent('POST', '/v1/checkout/sessions')[0]['params'];
        $this->assertSame(['setup', 'cus_1', $this->account->uuid], [$session['mode'], $session['customer'], $session['metadata']['billing_account_uuid']]);
        $this->assertSame('cus_1', $this->account->fresh()->stripe_id);

        $this->webhook($this->event('evt_setup', 'checkout.session.completed', [
            'id' => 'cs_1', 'object' => 'checkout.session', 'mode' => 'setup', 'customer' => 'cus_1', 'setup_intent' => 'seti_1',
            'metadata' => ['billing_account_uuid' => $this->account->uuid],
        ]))->assertOk();

        $account = $this->account->fresh();
        $this->assertSame(['visa', '4242', '2030-12'], [$account->pm_type, $account->pm_last_four, $account->pm_expires]);
        $this->assertSame('pm_new', $this->stripe->sent('POST', '/v1/customers/cus_1')[0]['params']['invoice_settings']['default_payment_method']);
        $this->assertCount(1, $this->stripe->sent('POST', '/v1/payment_methods/pm_old/detach'));
        $this->getJson('/api/v1/billing-accounts')
            ->assertOk()
            ->assertJsonPath('data.0.payments_enabled', true)
            ->assertJsonPath('data.0.payment_method', ['brand' => 'visa', 'last_four' => '4242', 'expires' => '2030-12']);

        // SC-011: nothing that looks like a card number is kept or logged.
        $kept = json_encode([DB::table('billing_accounts')->get(), DB::table('activity_log')->get(), DB::table('billing_payments')->get(), $logged]);
        $this->assertDoesNotMatchRegularExpression('/(?<!\d)\d{13,19}(?!\d)/', (string) $kept);

        // Removing the card on Stripe's side forgets it once the customer has no default.
        $this->stripe->on('GET', '/v1/customers/cus_1', ['id' => 'cus_1', 'object' => 'customer', 'invoice_settings' => ['default_payment_method' => null]]);
        $this->webhook($this->event('evt_detached', 'payment_method.detached', ['id' => 'pm_new', 'object' => 'payment_method', 'customer' => null], ['customer' => 'cus_1']))->assertOk();
        $this->assertNull($this->account->fresh()->pm_type);
    }

    public function test_an_issued_invoice_is_charged_to_the_saved_card_once_per_attempt(): void
    {
        $this->withCard();
        $this->stripe->on('POST', '/v1/payment_intents', fn (array $params): array => $this->intent('pi_1', 'succeeded', (string) $params['metadata']['invoice_uuid'], (int) $params['amount'], (int) $params['metadata']['attempt']));

        $invoice = $this->issued();
        Queue::assertPushed(ChargeInvoice::class, fn (ChargeInvoice $job): bool => $job->invoiceId === $invoice->id && $job->attempt === 1);

        // Run twice, as a retried job would: one charge.
        (new ChargeInvoice($invoice->id, 1))->handle(app(Payments::class));
        (new ChargeInvoice($invoice->id, 1))->handle(app(Payments::class));

        $charges = $this->stripe->sent('POST', '/v1/payment_intents');
        $this->assertCount(1, $charges);
        $this->assertSame('invoice:'.$invoice->uuid.':1', FakeStripe::header($charges[0], 'Idempotency-Key'));
        $this->assertSame([333, 'pm_card', 'cus_1', 'true', 'true'], [
            $charges[0]['params']['amount'], $charges[0]['params']['payment_method'], $charges[0]['params']['customer'],
            $charges[0]['params']['off_session'], $charges[0]['params']['confirm'],
        ]);
        $this->assertSame(PaymentStatus::Paid, $invoice->fresh()->payment_status);
        $this->assertSame([[Payment::CARD, 1, Payment::SUCCEEDED, 333]], $invoice->payments()->get()->map(fn (Payment $payment): array => [$payment->method, $payment->attempt, $payment->status, $payment->amount])->all());
        $this->assertSame(1, DB::table('billing_notices')->where('kind', 'receipt')->count());
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof PaymentMail && $job->mail->kind === 'receipt' && $job->mail->amount === 333);
    }

    public function test_a_decline_fails_the_payment_with_the_reason_and_the_owner_pays_on_stripes_page(): void
    {
        $this->withCard();
        $this->stripe->on('POST', '/v1/payment_intents', fn (array $params): array => ['error' => [
            'type' => 'card_error', 'code' => 'card_declined', 'message' => 'Your card was declined.',
            'payment_intent' => $this->intent('pi_2', 'requires_payment_method', (string) $params['metadata']['invoice_uuid'], 333, 1, 'Your card was declined.'),
        ]], 402);
        $invoice = $this->issued();

        (new ChargeInvoice($invoice->id, 1))->handle(app(Payments::class));

        $this->assertSame(PaymentStatus::Failed, $invoice->fresh()->payment_status);
        Queue::assertPushed(DeliverBillingEmail::class, function (DeliverBillingEmail $job) use ($invoice): bool {
            return $job->mail instanceof PaymentMail && $job->mail->kind === 'failed' && $job->mail->reason === 'Your card was declined.'
                && str_contains((string) $job->mail->content()->with['link'], '&invoice='.$invoice->uuid);
        });
        $this->actingAs($this->owner, 'sanctum')
            ->getJson($this->owned('/invoices/'.$invoice->uuid))
            ->assertOk()
            ->assertJsonPath('data.payment_status', 'failed')
            ->assertJsonPath('data.payments.0.status', 'failed')
            ->assertJsonPath('data.payments.0.failure_reason', 'Your card was declined.');

        // Stripe's event for the same failure changes nothing more.
        $this->webhook($this->event('evt_failed', 'payment_intent.payment_failed', $this->intent('pi_2', 'requires_payment_method', $invoice->uuid, 333, 1, 'Your card was declined.')))->assertOk();
        $this->assertSame(1, DB::table('billing_notices')->where('kind', 'payment_failed')->count());

        // The owner pays what is owed on Stripe's page.
        $this->stripe->on('POST', '/v1/checkout/sessions', ['id' => 'cs_2', 'object' => 'checkout.session', 'url' => 'https://checkout.stripe.test/c/cs_2']);
        $this->postJson($this->owned('/invoices/'.$invoice->uuid.'/checkout'))->assertOk()->assertJsonPath('data.url', 'https://checkout.stripe.test/c/cs_2');
        $session = $this->stripe->sent('POST', '/v1/checkout/sessions')[0]['params'];
        $this->assertSame(['payment', 333, $invoice->uuid], [$session['mode'], $session['line_items'][0]['price_data']['unit_amount'], $session['metadata']['invoice_uuid']]);

        $this->webhook($this->event('evt_paid', 'checkout.session.completed', [
            'id' => 'cs_2', 'object' => 'checkout.session', 'mode' => 'payment', 'payment_status' => 'paid', 'payment_intent' => 'pi_3',
            'amount_total' => 333, 'metadata' => ['invoice_uuid' => $invoice->uuid],
        ]))->assertOk();
        $this->assertSame(PaymentStatus::Paid, $invoice->fresh()->payment_status);
        $this->assertSame([Payment::FAILED, Payment::SUCCEEDED], $invoice->payments()->pluck('status')->all());
        $this->postJson($this->owned('/invoices/'.$invoice->uuid.'/checkout'))->assertConflict();
    }

    public function test_replayed_duplicated_and_out_of_order_events_change_nothing(): void
    {
        $this->withCard();
        $this->stripe->on('POST', '/v1/payment_intents', fn (array $params): array => $this->intent('pi_1', 'processing', (string) $params['metadata']['invoice_uuid'], 333));
        $invoice = $this->issued();
        (new ChargeInvoice($invoice->id, 1))->handle(app(Payments::class));
        $this->assertSame(Payment::PENDING, $invoice->payments()->sole()->status);

        $succeeded = $this->event('evt_ok', 'payment_intent.succeeded', $this->intent('pi_1', 'succeeded', $invoice->uuid, 333));
        $this->webhook($succeeded)->assertOk();
        $this->webhook($succeeded)->assertOk();
        $this->webhook(['id' => 'evt_ok_again'] + $succeeded)->assertOk();
        $this->webhook($this->event('evt_late', 'payment_intent.payment_failed', $this->intent('pi_1', 'requires_payment_method', $invoice->uuid, 333, 1, 'Too late')))->assertOk();
        $this->webhook($this->event('evt_other', 'payment_intent.succeeded', $this->intent('pi_unknown', 'succeeded', 'f0000000-0000-4000-8000-000000000000', 100)))->assertOk();
        $this->webhook($this->event('evt_ignored', 'customer.subscription.created', ['id' => 'sub_1', 'customer' => 'cus_1']))->assertOk();

        $payment = $invoice->payments()->sole();
        $this->assertSame([Payment::SUCCEEDED, null], [$payment->status, $payment->failure_reason]);
        $this->assertSame(PaymentStatus::Paid, $invoice->fresh()->payment_status);
        $this->assertSame(1, DB::table('billing_notices')->where('kind', 'receipt')->count());
        $this->assertSame(0, DB::table('billing_notices')->where('kind', 'payment_failed')->count());
        $this->assertSame(['evt_late', 'evt_ok', 'evt_ok_again', 'evt_other'], DB::table('billing_provider_events')->orderBy('provider_event_id')->pluck('provider_event_id')->all());
    }

    public function test_an_unsigned_or_wrongly_signed_webhook_is_refused(): void
    {
        $payload = (string) json_encode($this->event('evt_forged', 'payment_intent.succeeded', ['id' => 'pi_1']));

        $this->call('POST', '/api/stripe/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json'], $payload)->assertForbidden();
        $this->call('POST', '/api/stripe/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_STRIPE_SIGNATURE' => 't='.time().',v1=0000'], $payload)->assertForbidden();
        $this->assertSame(0, DB::table('billing_provider_events')->count());
    }

    public function test_reminders_and_retries_follow_the_due_date_and_past_due_restricts_nothing(): void
    {
        $this->withCard();
        $this->stripe->on('POST', '/v1/payment_intents', fn (array $params): array => ['error' => [
            'type' => 'card_error', 'code' => 'card_declined', 'message' => 'Your card was declined.',
            'payment_intent' => $this->intent('pi_'.$params['metadata']['attempt'], 'requires_payment_method', (string) $params['metadata']['invoice_uuid'], 333, (int) $params['metadata']['attempt'], 'Your card was declined.'),
        ]], 402);
        $devices = app(Allowances::class)->value($this->account, AllowanceKind::Devices);
        $invoice = $this->issued();
        (new ChargeInvoice($invoice->id, 1))->handle(app(Payments::class));
        $this->assertSame('2026-11-16', $invoice->fresh()->due_at->toDateString());

        $this->artisan('billing:payment-reminders', ['--now' => '2026-11-15 09:00:00'])->assertSuccessful();
        $this->assertSame(0, DB::table('billing_notices')->where('kind', 'payment_reminder')->count());

        // On the due date: a reminder and a second attempt, once however often it runs.
        $this->artisan('billing:payment-reminders', ['--now' => '2026-11-16 09:00:00'])
            ->expectsOutput('Sent 1 payment reminders, queued 1 card charges; 0 billing accounts are past due.')
            ->assertSuccessful();
        Queue::assertPushed(ChargeInvoice::class, fn (ChargeInvoice $job): bool => $job->attempt === 2);
        (new ChargeInvoice($invoice->id, 2))->handle(app(Payments::class));
        $this->assertSame('invoice:'.$invoice->uuid.':2', FakeStripe::header($this->stripe->sent('POST', '/v1/payment_intents')[1], 'Idempotency-Key'));
        $this->artisan('billing:payment-reminders', ['--now' => '2026-11-16 18:00:00'])
            ->expectsOutput('Sent 0 payment reminders, queued 0 card charges; 1 billing accounts are past due.')
            ->assertSuccessful();
        $this->assertSame('2026-11-16T18:00:00+00:00', $this->account->fresh()->past_due_since?->toIso8601String());
        $this->assertSame(['invoice:'.$invoice->uuid.':due'], DB::table('billing_notices')->where('kind', 'payment_reminder')->pluck('key')->all());

        // Seven days after: the last reminder and attempt; the first flag date is kept.
        $this->artisan('billing:payment-reminders', ['--now' => '2026-11-23 09:00:00'])->assertSuccessful();
        Queue::assertPushed(ChargeInvoice::class, fn (ChargeInvoice $job): bool => $job->attempt === 3);
        $this->assertSame(2, DB::table('billing_notices')->where('kind', 'payment_reminder')->count());
        $this->assertSame('2026-11-16T18:00:00+00:00', $this->account->fresh()->past_due_since?->toIso8601String());
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/admin/billing-accounts?past_due=1')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.past_due_since', '2026-11-16T18:00:00+00:00');

        // FR-043: being past due changes nothing the organizations do.
        $this->assertSame($devices, app(Allowances::class)->value($this->account->fresh(), AllowanceKind::Devices));
        $manager = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->actingAs($manager, 'sanctum')->getJson('/api/v1/organizations/'.$this->acme->uuid.'/usage')->assertOk();

        // A bank transfer recorded by an administrator settles it and clears the flag.
        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/payments', ['amount' => 333, 'note' => 'Bank transfer 1234'])
            ->assertCreated()
            ->assertJsonPath('data.payment_status', 'paid_outside')
            ->assertJsonPath('data.outstanding', 0)
            ->assertJsonPath('data.payments.2.method', 'outside')
            ->assertJsonPath('data.payments.2.note', 'Bank transfer 1234')
            ->assertJsonPath('data.history.0.action', 'payment_recorded');
        $this->assertNull($this->account->fresh()->past_due_since);
    }

    public function test_payments_recorded_by_hand_and_reconciled_with_stripe(): void
    {
        $invoice = $this->issued();
        $this->actingAs($this->admin, 'sanctum');
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/payments', ['amount' => 100, 'note' => null])
            ->assertCreated()
            ->assertJsonPath('data.payment_status', 'pending')
            ->assertJsonPath('data.outstanding', 233);
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/payments', ['amount' => 234])->assertUnprocessable()->assertJsonValidationErrors('amount');

        // A charge Stripe left processing is settled by asking Stripe.
        $this->withCard();
        $this->stripe
            ->on('POST', '/v1/payment_intents', fn (array $params): array => $this->intent('pi_9', 'processing', (string) $params['metadata']['invoice_uuid'], (int) $params['amount']))
            ->on('GET', '/v1/payment_intents/pi_9', $this->intent('pi_9', 'succeeded', $invoice->uuid, 233));
        (new ChargeInvoice($invoice->id, 2))->handle(app(Payments::class));
        $this->assertSame(233, $this->stripe->sent('POST', '/v1/payment_intents')[0]['params']['amount']);
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/reconcile')
            ->assertOk()
            ->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.payments.1.status', 'succeeded');
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/payments', ['amount' => 1])->assertUnprocessable();
    }

    public function test_with_payments_off_every_payment_route_answers_404_and_no_card_is_offered(): void
    {
        config(['cashier.secret' => null]);
        $invoice = $this->issued();
        Queue::assertNotPushed(ChargeInvoice::class);

        $this->actingAs($this->owner, 'sanctum');
        $this->postJson($this->owned('/payment-method/checkout'))->assertNotFound();
        $this->deleteJson($this->owned('/payment-method'))->assertNotFound();
        $this->postJson($this->owned('/invoices/'.$invoice->uuid.'/checkout'))->assertNotFound();
        $this->getJson('/api/v1/billing-accounts')->assertOk()->assertJsonPath('data.0.payments_enabled', false)->assertJsonPath('data.0.payment_method', null);
        $this->webhook($this->event('evt_off', 'payment_intent.succeeded', ['id' => 'pi_1']))->assertNotFound();

        $this->actingAs($this->admin, 'sanctum');
        $this->getJson('/api/v1/admin/billing/settings')->assertOk()->assertJsonPath('data.payments_enabled', false);
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/reconcile')->assertNotFound();
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/payments', ['amount' => 333])->assertCreated()->assertJsonPath('data.payment_status', 'paid_outside');
        $this->assertSame([], $this->stripe->requests);
    }

    public function test_only_an_owner_reaches_the_card_and_online_payment(): void
    {
        $this->withCard();
        $invoice = $this->issued();
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();

        $this->actingAs($member, 'sanctum');
        $this->postJson($this->owned('/payment-method/checkout'))->assertNotFound();
        $this->deleteJson($this->owned('/payment-method'))->assertNotFound();
        $this->postJson($this->owned('/invoices/'.$invoice->uuid.'/checkout'))->assertNotFound();
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/payments', ['amount' => 1])->assertForbidden();
        $this->postJson('/api/v1/admin/billing/invoices/'.$invoice->uuid.'/reconcile')->assertForbidden();

        $this->stripe->on('POST', '/v1/payment_methods/pm_card/detach', ['id' => 'pm_card', 'object' => 'payment_method']);
        $this->actingAs($this->owner, 'sanctum')->deleteJson($this->owned('/payment-method'))->assertNoContent();
        $this->assertCount(1, $this->stripe->sent('POST', '/v1/payment_methods/pm_card/detach'));
        $this->assertNull($this->account->fresh()->pm_type);
        $this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)->assertForbidden();
        $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)->assertOk()->assertJsonPath('data.payment_method', null);
    }

    private function owned(string $path): string
    {
        return '/api/v1/billing-accounts/'.$this->account->uuid.$path;
    }

    private function issued(): Invoice
    {
        return app(InvoiceIssuer::class)->issue(app(InvoiceDrafter::class)->draft($this->account, CarbonImmutable::parse('2026-10-01', 'UTC'), null, null), $this->admin);
    }

    /** A saved card: the customer's default payment method on Stripe. */
    private function withCard(): void
    {
        $this->account->forceFill(['stripe_id' => 'cus_1', 'pm_type' => 'visa', 'pm_last_four' => '4242', 'pm_expires' => '2030-12'])->save();
        $this->stripe->on('GET', '/v1/customers/cus_1', ['id' => 'cus_1', 'object' => 'customer', 'invoice_settings' => ['default_payment_method' => 'pm_card']]);
    }

    /**
     * @return array<string, mixed>
     */
    private function intent(string $id, string $status, string $invoiceUuid, int $amount, int $attempt = 1, ?string $error = null): array
    {
        return [
            'id' => $id,
            'object' => 'payment_intent',
            'status' => $status,
            'amount' => $amount,
            'amount_received' => $status === 'succeeded' ? $amount : 0,
            'currency' => 'usd',
            'metadata' => ['invoice_uuid' => $invoiceUuid, 'method' => Payment::CARD, 'attempt' => (string) $attempt],
            'last_payment_error' => $error === null ? null : ['message' => $error],
        ];
    }

    /**
     * @param  array<string, mixed>  $object
     * @param  array<string, mixed>  $previous
     * @return array<string, mixed>
     */
    private function event(string $id, string $type, array $object, array $previous = []): array
    {
        return ['id' => $id, 'object' => 'event', 'type' => $type, 'data' => ['object' => $object] + ($previous === [] ? [] : ['previous_attributes' => $previous])];
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function webhook(array $event): TestResponse
    {
        $payload = (string) json_encode($event);
        $time = time();
        $signature = hash_hmac('sha256', $time.'.'.$payload, self::SECRET);

        return $this->call('POST', '/api/stripe/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_STRIPE_SIGNATURE' => "t={$time},v1={$signature}"], $payload);
    }
}
