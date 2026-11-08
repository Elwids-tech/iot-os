<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Billing accounts are put on plans and allowances resolve as override, else plan,
 * else the deployment's default (spec 028 US2, FR-007 to FR-011, SC-007; ADR-035).
 */
final class PlanAssignmentTest extends TestCase
{
    use RefreshDatabase;

    private User $administrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->administrator = User::factory()->create(['name' => 'Platform Admin', 'is_super_admin' => true]);
    }

    public function test_an_account_with_no_plan_gets_the_deployment_defaults(): void
    {
        $account = BillingAccount::factory()->create();

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson('/api/v1/admin/billing-accounts/'.$account->uuid)
            ->assertOk()
            ->assertJsonPath('data.plan_assignment', null)
            ->assertJsonPath('data.organization_limit', 1)
            ->assertJsonPath('data.allowances', [
                ['kind' => 'alerts', 'value' => null, 'source' => 'default', 'note' => null],
                ['kind' => 'sms', 'value' => 0, 'source' => 'default', 'note' => null],
                ['kind' => 'devices', 'value' => null, 'source' => 'default', 'note' => null],
                ['kind' => 'data_points', 'value' => null, 'source' => 'default', 'note' => null],
                ['kind' => 'retention_days', 'value' => null, 'source' => 'default', 'note' => null],
                ['kind' => 'organizations', 'value' => 1, 'source' => 'default', 'note' => null],
            ]);
    }

    public function test_allowances_resolve_override_then_plan_then_default(): void
    {
        $plan = BillingPlan::factory()->withAllowances(['devices' => 50, 'organizations' => 10])->create(['name' => 'Growth']);
        $account = BillingAccount::factory()->create();
        $other = BillingAccount::factory()->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/plan', ['plan_uuid' => $plan->uuid])
            ->assertOk()
            ->assertJsonPath('data.plan_assignment.plan.name', 'Growth')
            ->assertJsonPath('data.plan_assignment.kind', 'paid')
            ->assertJsonPath('data.organization_limit', 10);
        $this->putJson('/api/v1/admin/billing-accounts/'.$other->uuid.'/plan', ['plan_uuid' => $plan->uuid])->assertOk();

        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/devices', ['value' => 80, 'note' => 'Agreed for the 2026 rollout'])
            ->assertOk()
            ->assertJsonPath('data.allowances.2', ['kind' => 'devices', 'value' => 80, 'source' => 'override', 'note' => 'Agreed for the 2026 rollout'])
            ->assertJsonPath('data.allowances.0.source', 'default')
            ->assertJsonPath('data.allowances.5', ['kind' => 'organizations', 'value' => 10, 'source' => 'plan', 'note' => null]);

        // The other account on the same plan is unchanged.
        $resolved = app(Allowances::class)->resolve($other, AllowanceKind::Devices);
        $this->assertSame([50, 'plan'], [$resolved->value, $resolved->source]);

        $this->deleteJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/devices')
            ->assertOk()
            ->assertJsonPath('data.allowances.2', ['kind' => 'devices', 'value' => 50, 'source' => 'plan', 'note' => null]);

        $events = DB::table('activity_log')->where('subject_uuid', $account->uuid)->orderBy('id')->pluck('event')->all();
        $this->assertSame([
            'billing_account.plan_assigned',
            'billing_account.allowance_overridden',
            'billing_account.allowance_override_removed',
        ], $events);
    }

    public function test_an_override_survives_plan_changes_and_can_be_unlimited(): void
    {
        $starter = BillingPlan::factory()->withAllowances(['alerts' => 100])->create();
        $growth = BillingPlan::factory()->withAllowances(['alerts' => 1000])->create();
        $account = BillingAccount::factory()->onPlan($starter)->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/alerts', ['value' => null, 'note' => 'Pilot'])->assertOk();
        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/plan', ['plan_uuid' => $growth->uuid])
            ->assertOk()
            ->assertJsonPath('data.allowances.0', ['kind' => 'alerts', 'value' => null, 'source' => 'override', 'note' => 'Pilot']);
    }

    public function test_override_values_are_validated(): void
    {
        $account = BillingAccount::factory()->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/retention_days', ['value' => null, 'note' => 'x'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['value']);
        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/devices', ['value' => 5])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['note']);
        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/storage', ['value' => 5, 'note' => 'x'])
            ->assertNotFound();
        $this->assertSame(0, $account->allowanceOverrides()->count());
    }

    public function test_assignments_follow_one_another_and_answer_for_past_instants(): void
    {
        $starter = BillingPlan::factory()->create(['name' => 'Starter']);
        $growth = BillingPlan::factory()->create(['name' => 'Growth']);
        $account = BillingAccount::factory()->create();
        $assignments = app(PlanAssignments::class);

        $this->travelTo(CarbonImmutable::parse('2026-11-01 09:00:00'));
        $assignments->assign($account, $starter, $this->administrator);
        $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00'));
        $assignments->assign($account, $growth, $this->administrator);
        // Assigning the plan the account is already on changes nothing.
        $assignments->assign($account, $growth, $this->administrator);
        $this->travelTo(CarbonImmutable::parse('2026-11-20 08:00:00'));
        $assignments->remove($account, $this->administrator);

        $rows = PlanAssignment::query()->where('billing_account_id', $account->getKey())->orderBy('started_at')->get();
        $this->assertCount(2, $rows);
        $this->assertTrue($rows[0]->ended_at->equalTo($rows[1]->started_at));
        $this->assertSame(['changed', 'removed'], $rows->pluck('end_reason')->all());

        $this->assertNull($assignments->at($account, CarbonImmutable::parse('2026-10-31 23:59:59')));
        $this->assertSame('Starter', $assignments->at($account, CarbonImmutable::parse('2026-11-05 00:00:00'))?->plan->name);
        $this->assertSame('Growth', $assignments->at($account, CarbonImmutable::parse('2026-11-10 12:00:00'))?->plan->name);
        $this->assertNull($assignments->at($account, CarbonImmutable::parse('2026-11-25 00:00:00')));
        $this->assertNull($assignments->current($account));
    }

    public function test_the_database_allows_one_open_assignment_per_account(): void
    {
        $plan = BillingPlan::factory()->create();
        $account = BillingAccount::factory()->onPlan($plan)->create();

        $this->expectException(UniqueConstraintViolationException::class);
        PlanAssignment::query()->create([
            'billing_account_id' => $account->getKey(),
            'billing_plan_id' => $plan->getKey(),
            'kind' => 'paid',
            'started_at' => now(),
        ]);
    }

    public function test_an_organization_is_created_with_a_new_billing_account_on_a_plan(): void
    {
        $plan = BillingPlan::factory()->create(['name' => 'Growth']);
        $archived = BillingPlan::factory()->archived()->create();
        $existing = BillingAccount::factory()->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->postJson('/api/v1/admin/organizations', [
            'name' => 'Corner Shop',
            'slug' => 'corner-shop',
            'new_billing_account' => ['name' => 'Corner Shop Billing'],
            'plan_uuid' => $plan->uuid,
        ])->assertCreated();
        $account = Organization::query()->where('slug', 'corner-shop')->firstOrFail()->billingAccount;
        $this->assertSame('Growth', app(PlanAssignments::class)->current($account)?->plan->name);

        $this->postJson('/api/v1/admin/organizations', ['name' => 'A', 'slug' => 'a', 'plan_uuid' => $archived->uuid])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['plan_uuid' => 'Choose a plan that exists and is not archived.']);
        $this->postJson('/api/v1/admin/organizations', ['name' => 'B', 'slug' => 'b', 'billing_account_uuid' => $existing->uuid, 'plan_uuid' => $plan->uuid])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['plan_uuid']);
        $this->assertNull(app(PlanAssignments::class)->current($existing));
    }

    public function test_the_billing_account_list_shows_and_filters_by_plan(): void
    {
        $growth = BillingPlan::factory()->create(['name' => 'Growth']);
        BillingAccount::factory()->onPlan($growth)->create(['name' => 'On Growth']);
        BillingAccount::factory()->create(['name' => 'On Nothing']);
        $this->actingAs($this->administrator, 'sanctum');

        $this->getJson('/api/v1/admin/billing-accounts?plan='.$growth->uuid)
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.name', 'On Growth')
            ->assertJsonPath('data.0.plan', ['uuid' => $growth->uuid, 'name' => 'Growth', 'kind' => 'paid', 'trial_ends_at' => null]);
        $this->getJson('/api/v1/admin/billing-accounts?plan=none')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.name', 'On Nothing')
            ->assertJsonPath('data.0.plan', null);
    }

    public function test_the_account_history_shows_plan_and_allowance_changes(): void
    {
        $plan = BillingPlan::factory()->create(['name' => 'Growth']);
        $account = BillingAccount::factory()->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/plan', ['plan_uuid' => $plan->uuid])->assertOk();
        $this->travel(1)->minutes();
        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/devices', ['value' => 20, 'note' => 'Pilot'])
            ->assertOk()
            ->assertJsonPath('data.history.0.action', 'updated')
            ->assertJsonPath('data.history.0.changes', [['field' => 'devices', 'from' => 'Unlimited', 'to' => '20']])
            ->assertJsonPath('data.history.1.changes', [['field' => 'plan', 'from' => null, 'to' => 'Growth']]);
    }
}
