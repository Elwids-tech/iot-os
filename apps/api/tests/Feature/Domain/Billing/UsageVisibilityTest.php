<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Jobs\DeliverBillingEmail;
use App\Domain\Billing\Mail\UsageThresholdMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Billing\Services\Usage;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Who sees usage (constitution III; spec 028 US4, FR-019 to FR-023, SC-005, SC-006):
 * administrators everything, owners their accounts with each organization's share,
 * managers their organization's counts and what is left on the account and nothing
 * else, other members nothing. Owners are warned once per threshold, allowance and month.
 */
final class UsageVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $acme;

    private Organization $lakeside;

    private BillingAccount $account;

    private User $admin;

    private User $owner;

    private Usage $usage;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Queue::fake();
        config(['services.twilio.account_sid' => 'AC-test', 'services.twilio.from' => '+15550100000']);
        $this->usage = app(Usage::class);
        $this->admin = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->account = $this->acme->billingAccount;
        $this->account->forceFill(['name' => 'Integrator Billing'])->save();
        $this->lakeside = Organization::factory()->forBillingAccount($this->account)->create(['name' => 'Lakeside Home']);
        $this->owner = User::factory()->create(['name' => 'Olive Owner']);
        $this->account->owners()->attach($this->owner->id, ['created_at' => now()]);
        $plan = BillingPlan::factory()->withAllowances(['alerts' => 10, 'sms' => 5])->create(['name' => 'Integrator plan']);
        app(PlanAssignments::class)->assign($this->account, $plan, $this->admin);

        $now = CarbonImmutable::now();
        $this->usage->add($this->account, $this->acme, AllowanceKind::Alerts, $now, 3);
        $this->usage->add($this->account, $this->lakeside, AllowanceKind::Alerts, $now, 2);
        $this->usage->reserve($this->account, $this->acme, 2, $now);
    }

    public function test_an_owner_sees_usage_with_each_organizations_share_and_a_non_owner_gets_404(): void
    {
        $month = Usage::monthOf(CarbonImmutable::now());

        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/usage')
            ->assertOk()
            ->assertExactJson(['data' => [
                ['kind' => 'alerts', 'month' => $month, 'count' => 5, 'allowance' => 10, 'left' => 5, 'overage' => 0, 'organizations' => [
                    ['organization_uuid' => $this->acme->uuid, 'name' => 'Acme Manufacturing', 'count' => 3],
                    ['organization_uuid' => $this->lakeside->uuid, 'name' => 'Lakeside Home', 'count' => 2],
                ]],
                ['kind' => 'sms', 'month' => $month, 'count' => 2, 'allowance' => 5, 'left' => 3, 'overage' => 0, 'organizations' => [
                    ['organization_uuid' => $this->acme->uuid, 'name' => 'Acme Manufacturing', 'count' => 2],
                ]],
            ]]);

        $this->getJson('/api/v1/billing-accounts')
            ->assertOk()
            ->assertJsonPath('data.0.plan.name', 'Integrator plan')
            ->assertJsonPath('data.0.usage.0.count', 5)
            ->assertJsonPath('data.0.usage.1.kind', 'sms')
            ->assertJsonCount(count(AllowanceKind::cases()), 'data.0.allowances');

        $this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/usage?month=2026-13')->assertUnprocessable();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/usage')
            ->assertNotFound();
    }

    public function test_administrators_see_usage_on_the_account_page_and_for_any_month(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)
            ->assertOk()
            ->assertJsonPath('data.usage.0.kind', 'alerts')
            ->assertJsonPath('data.usage.0.count', 5)
            ->assertJsonPath('data.usage.0.organizations.1.name', 'Lakeside Home');

        $this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage?month=2025-01')
            ->assertOk()
            ->assertJsonPath('data.0.month', '2025-01-01')
            ->assertJsonPath('data.0.count', 0)
            ->assertJsonPath('data.0.organizations', []);

        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage')
            ->assertForbidden();
    }

    public function test_a_manager_sees_their_organization_only_with_no_account_name_other_organizations_or_prices(): void
    {
        $manager = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $month = Usage::monthOf(CarbonImmutable::now());

        $response = $this->actingAs($manager, 'sanctum')
            ->getJson('/api/v1/organizations/'.$this->acme->uuid.'/usage')
            ->assertOk()
            ->assertExactJson(['data' => [
                ['kind' => 'alerts', 'month' => $month, 'count' => 3, 'allowance' => 10, 'left' => 5, 'overage' => 0],
                ['kind' => 'sms', 'month' => $month, 'count' => 2, 'allowance' => 5, 'left' => 3, 'overage' => 0],
            ]]);

        foreach (['Integrator Billing', 'Lakeside Home', $this->lakeside->uuid, $this->account->uuid, 'Integrator plan'] as $hidden) {
            $this->assertStringNotContainsString($hidden, (string) $response->getContent());
        }
    }

    public function test_members_without_device_manage_get_403(): void
    {
        foreach (['acme.member@example.test', 'acme.moderator@example.test'] as $email) {
            $this->actingAs(User::where('email', $email)->firstOrFail(), 'sanctum')
                ->getJson('/api/v1/organizations/'.$this->acme->uuid.'/usage')
                ->assertForbidden();
        }
    }

    public function test_a_manager_of_one_organization_cannot_read_anothers_usage(): void
    {
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();

        // A manager of Northstar is not a member of Acme.
        $this->actingAs(User::where('email', 'northstar.admin@example.test')->firstOrFail(), 'sanctum')
            ->getJson('/api/v1/organizations/'.$this->acme->uuid.'/usage')
            ->assertForbidden();
        // Acme's manager is only a moderator in Northstar.
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail(), 'sanctum')
            ->getJson('/api/v1/organizations/'.$northstar->uuid.'/usage')
            ->assertForbidden();
    }

    public function test_without_an_sms_provider_owners_and_managers_see_no_sms(): void
    {
        config(['services.twilio.account_sid' => null, 'services.twilio.from' => null]);
        $manager = User::where('email', 'shared.operator@example.test')->firstOrFail();

        $this->actingAs($this->owner, 'sanctum');
        $this->assertSame(['alerts'], array_column($this->getJson('/api/v1/billing-accounts/'.$this->account->uuid.'/usage')->assertOk()->json('data'), 'kind'));
        $owned = $this->getJson('/api/v1/billing-accounts')->assertOk()->json('data.0');
        $this->assertSame(['alerts'], array_column($owned['usage'], 'kind'));
        $this->assertNotContains('sms', array_column($owned['allowances'], 'kind'));

        $this->actingAs($manager, 'sanctum');
        $this->assertSame(['alerts'], array_column($this->getJson('/api/v1/organizations/'.$this->acme->uuid.'/usage')->assertOk()->json('data'), 'kind'));

        $this->actingAs($this->admin, 'sanctum');
        $this->assertSame(['alerts', 'sms'], array_column($this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage')->assertOk()->json('data'), 'kind'));
        $this->assertContains('sms', array_column($this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid)->json('data.allowances'), 'kind'));
    }

    public function test_owners_get_one_email_per_threshold_allowance_and_month(): void
    {
        $now = CarbonImmutable::now();
        $second = User::factory()->create();
        $this->account->owners()->attach($second->id, ['created_at' => now()]);

        // Alerts: 5 of 10 so far. 8 passes 80%, 10 uses it up, and later alerts send nothing more.
        $this->usage->add($this->account, $this->acme, AllowanceKind::Alerts, $now, 2);
        $this->assertSame([], $this->notices());
        $this->usage->add($this->account, $this->acme, AllowanceKind::Alerts, $now, 1);
        $this->usage->add($this->account, $this->acme, AllowanceKind::Alerts, $now, 1);
        $this->usage->add($this->account, $this->acme, AllowanceKind::Alerts, $now, 1);
        $this->usage->add($this->account, $this->acme, AllowanceKind::Alerts, $now, 4);
        // SMS: 2 of 5; 4 passes 80%.
        $this->usage->reserve($this->account, $this->acme, 2, $now);

        $month = $now->utc()->format('Y-m');
        $this->assertSame(["alerts:{$month}:100", "alerts:{$month}:80", "sms:{$month}:80"], $this->notices());
        // One job per owner and notice.
        Queue::assertPushed(DeliverBillingEmail::class, 6);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->userId === $second->id && $job->mail instanceof UsageThresholdMail && $job->mail->kind === 'sms');

        // A new month warns again.
        $next = $now->addMonthNoOverflow();
        $this->usage->add($this->account, $this->acme, AllowanceKind::Alerts, $next, 8);
        $this->assertContains('alerts:'.$next->utc()->format('Y-m').':80', $this->notices());
    }

    public function test_the_email_names_the_account_the_allowance_what_is_used_and_left_and_links_to_billing(): void
    {
        Mail::fake();
        $mail = new UsageThresholdMail($this->account->uuid, 'Integrator Billing', 'sms', '2026-11-01', 80, 4, 5);

        (new DeliverBillingEmail($this->owner->id, $this->account->id, $mail))->handle();

        Mail::assertSent(UsageThresholdMail::class, fn (UsageThresholdMail $sent): bool => $sent->hasTo($this->owner->email));
        $this->assertSame('SMS allowance 80% used: Integrator Billing', $mail->envelope()->subject);
        $text = $mail->render();
        $this->assertStringContainsString('The billing account Integrator Billing has used 80% of its SMS allowance for November 2026.', $text);
        $this->assertStringContainsString('Used: 4 of 5', $text);
        $this->assertStringContainsString('Left: 1', $text);
        $this->assertStringContainsString(rtrim((string) config('app.frontend_url'), '/').'/billing?account='.$this->account->uuid, $text);

        // Someone no longer an owner by the time the worker runs gets nothing.
        Mail::fake();
        $this->account->owners()->detach($this->owner->id);
        (new DeliverBillingEmail($this->owner->id, $this->account->id, $mail))->handle();
        Mail::assertNothingSent();
    }

    public function test_unlimited_allowances_and_accounts_without_owners_send_no_warning(): void
    {
        $now = CarbonImmutable::now();
        $ownerless = BillingAccount::factory()->onPlan(BillingPlan::factory()->withAllowances(['alerts' => 1])->create())->create();
        $organization = Organization::factory()->forBillingAccount($ownerless)->create();
        $this->usage->add($ownerless, $organization, AllowanceKind::Alerts, $now, 3);

        $unlimited = BillingAccount::factory()->ownedBy($this->owner)->create();
        $this->usage->add($unlimited, Organization::factory()->forBillingAccount($unlimited)->create(), AllowanceKind::Alerts, $now, 1000);

        $this->assertSame(0, DB::table('billing_notices')->whereIn('billing_account_id', [$ownerless->id, $unlimited->id])->count());
        Queue::assertNotPushed(DeliverBillingEmail::class);
    }

    public function test_the_admin_list_finds_accounts_at_80_percent_of_any_limited_allowance(): void
    {
        $now = CarbonImmutable::now();
        $make = function (string $name, array $plan = [], array $overrides = []): array {
            $account = BillingAccount::factory()->create(['name' => $name]);
            if ($plan !== []) {
                app(PlanAssignments::class)->assign($account, BillingPlan::factory()->withAllowances($plan)->create(), $this->admin);
            }
            foreach ($overrides as $kind => $value) {
                app(Allowances::class)->override($account, AllowanceKind::from($kind), $value, 'Test', $this->admin);
            }

            return [$account, Organization::factory()->forBillingAccount($account)->create()];
        };
        config(['billing.defaults.sms' => 10]);

        [$atEighty, $org] = $make('At eighty', ['alerts' => 5]);
        $this->usage->add($atEighty, $org, AllowanceKind::Alerts, $now, 4);
        [$atSixty, $org] = $make('At sixty', ['alerts' => 5]);
        $this->usage->add($atSixty, $org, AllowanceKind::Alerts, $now, 3);
        [$unlimited, $org] = $make('Unlimited');
        $this->usage->add($unlimited, $org, AllowanceKind::Alerts, $now, 100);
        // No plan: the deployment's SMS default of 10.
        [$byDefault, $org] = $make('By default');
        $this->usage->reserve($byDefault, $org, 8, $now);
        // An override of 2 over a plan of 100.
        [$byOverride, $org] = $make('By override', ['alerts' => 100], ['alerts' => 2]);
        $this->usage->add($byOverride, $org, AllowanceKind::Alerts, $now, 2);
        // Last month does not count.
        [$lastMonth, $org] = $make('Last month', ['alerts' => 1]);
        $this->usage->add($lastMonth, $org, AllowanceKind::Alerts, $now->subMonthNoOverflow(), 5);

        $names = array_column(
            $this->actingAs($this->admin, 'sanctum')->getJson('/api/v1/admin/billing-accounts?usage_at_least=80&per_page=100')->assertOk()->json('data'),
            'name',
        );

        // The seeded Acme account is at 50% of alerts and 40% of SMS.
        $this->assertSame(['At eighty', 'By default', 'By override'], $names);
        $this->getJson('/api/v1/admin/billing-accounts?usage_at_least=0')->assertUnprocessable();
    }

    /**
     * @return list<string>
     */
    private function notices(): array
    {
        return DB::table('billing_notices')
            ->where('billing_account_id', $this->account->id)
            ->where('kind', 'usage_threshold')
            ->orderBy('key')
            ->pluck('key')
            ->all();
    }
}
