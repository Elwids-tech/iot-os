<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Shared\Models\User;
use Database\Seeders\PermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Tests\TestCase;

/**
 * Platform administrators define plans (spec 028 US1, spec 029 US1).
 */
final class PlanAdministrationTest extends TestCase
{
    use RefreshDatabase;

    private User $administrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->administrator = User::factory()->create(['name' => 'Platform Admin', 'is_super_admin' => true]);
    }

    public function test_a_plan_is_created_with_every_kind_of_allowance(): void
    {
        $uuid = $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/billing-plans', [
                'name' => 'Growth',
                'description' => 'For teams with a few sites.',
                'allowances' => [
                    'alerts' => 3,
                    'sms' => 2,
                    'devices' => 50,
                    'data_points' => null,
                    'retention_days' => 30,
                    'organizations' => 2,
                ],
            ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Growth')
            ->assertJsonPath('data.archived', false)
            ->assertJsonPath('data.accounts_count', 0)
            ->assertJsonPath('data.allowances', [
                ['kind' => 'alerts', 'value' => 3],
                ['kind' => 'sms', 'value' => 2],
                ['kind' => 'devices', 'value' => 50],
                ['kind' => 'data_points', 'value' => null],
                ['kind' => 'retention_days', 'value' => 30],
                ['kind' => 'organizations', 'value' => 2],
            ])
            ->assertJsonPath('data.history.0.action', 'created')
            ->assertJsonPath('data.history.0.actor.id', $this->administrator->id)
            ->json('data.uuid');

        $this->assertSame(1, DB::table('activity_log')->where('event', 'billing_plan.created')->where('subject_uuid', $uuid)->count());
    }

    public function test_a_kind_left_out_is_not_set_on_the_plan(): void
    {
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/billing-plans', ['name' => 'Starter', 'allowances' => ['alerts' => 10]])
            ->assertCreated()
            ->assertJsonPath('data.allowances', [['kind' => 'alerts', 'value' => 10]]);
    }

    public function test_plan_values_are_validated(): void
    {
        BillingPlan::factory()->create(['name' => 'Growth']);
        $this->actingAs($this->administrator, 'sanctum');

        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'GROWTH'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name' => 'A plan with this name already exists.']);
        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'A', 'allowances' => ['retention_days' => null]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['allowances.retention_days']);
        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'B', 'allowances' => ['retention_days' => 0]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['allowances.retention_days']);
        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'C', 'allowances' => ['retention_days' => 36501]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['allowances.retention_days']);
        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'D', 'allowances' => ['devices' => -1]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['allowances.devices']);
        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'E', 'allowances' => ['storage' => 5]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['allowances']);
        $this->assertSame(1, BillingPlan::query()->count());
    }

    public function test_changing_the_allowances_of_a_plan_in_use_needs_the_number_of_accounts_confirmed(): void
    {
        $plan = BillingPlan::factory()->withAllowances(['alerts' => 3])->create(['name' => 'Growth']);
        BillingAccount::factory()->count(2)->onPlan($plan)->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->patchJson('/api/v1/admin/billing-plans/'.$plan->uuid, ['allowances' => ['alerts' => 5]])
            ->assertConflict()
            ->assertJsonPath('affected_accounts', 2)
            ->assertJsonPath('message', 'This changes the allowances of 2 billing accounts. Confirm to apply it to all of them.');
        $this->patchJson('/api/v1/admin/billing-plans/'.$plan->uuid, ['allowances' => ['alerts' => 5], 'confirm_affected' => 1])
            ->assertConflict();

        $this->patchJson('/api/v1/admin/billing-plans/'.$plan->uuid, ['allowances' => ['alerts' => 5], 'confirm_affected' => 2])
            ->assertOk()
            ->assertJsonPath('data.allowances', [['kind' => 'alerts', 'value' => 5]])
            ->assertJsonPath('data.accounts_count', 2)
            ->assertJsonPath('data.history.0.action', 'updated')
            ->assertJsonPath('data.history.0.changes', [['field' => 'alerts', 'from' => '3', 'to' => '5']]);

        // A rename needs no confirmation.
        $this->patchJson('/api/v1/admin/billing-plans/'.$plan->uuid, ['name' => 'Growth 2026'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Growth 2026');
    }

    public function test_an_unused_plan_changes_without_confirmation_and_unchanged_values_record_nothing(): void
    {
        $plan = BillingPlan::factory()->withAllowances(['alerts' => 3, 'sms' => 2])->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->patchJson('/api/v1/admin/billing-plans/'.$plan->uuid, ['allowances' => ['alerts' => 3, 'sms' => 2]])->assertOk();
        $this->assertSame(0, DB::table('activity_log')->where('event', 'billing_plan.updated')->count());

        $this->patchJson('/api/v1/admin/billing-plans/'.$plan->uuid, ['allowances' => ['alerts' => null]])
            ->assertOk()
            ->assertJsonPath('data.allowances', [['kind' => 'alerts', 'value' => null]])
            ->assertJsonPath('data.history.0.changes', [
                ['field' => 'alerts', 'from' => '3', 'to' => 'Unlimited'],
                ['field' => 'sms', 'from' => '2', 'to' => 'Default'],
            ]);
    }

    public function test_plan_history_lists_allowances_in_kind_order_whatever_the_stored_key_order(): void
    {
        $plan = BillingPlan::factory()->create();
        // As PostgreSQL's jsonb stores them: shorter keys first.
        ActivityLog::record('billing_plan.updated', null, $this->administrator, $plan, [
            'changes' => [],
            'allowances' => ['sms' => ['from' => 2, 'to' => 'default'], 'alerts' => ['from' => 3, 'to' => 5]],
        ]);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson('/api/v1/admin/billing-plans/'.$plan->uuid)
            ->assertOk()
            ->assertJsonPath('data.history.0.changes', [
                ['field' => 'alerts', 'from' => '3', 'to' => '5'],
                ['field' => 'sms', 'from' => '2', 'to' => 'Default'],
            ]);
    }

    public function test_an_archived_plan_stays_on_its_accounts_and_can_be_restored(): void
    {
        $plan = BillingPlan::factory()->create(['name' => 'Legacy']);
        $account = BillingAccount::factory()->onPlan($plan)->create();
        $other = BillingAccount::factory()->create();
        $this->actingAs($this->administrator, 'sanctum');

        $this->postJson('/api/v1/admin/billing-plans/'.$plan->uuid.'/archive')
            ->assertOk()
            ->assertJsonPath('data.archived', true);
        $this->getJson('/api/v1/admin/billing-accounts/'.$account->uuid)
            ->assertJsonPath('data.plan_assignment.plan.name', 'Legacy')
            ->assertJsonPath('data.plan_assignment.plan.archived', true);
        $this->putJson('/api/v1/admin/billing-accounts/'.$other->uuid.'/plan', ['plan_uuid' => $plan->uuid])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['plan_uuid' => 'This plan is archived. Restore it before assigning it.']);
        $this->getJson('/api/v1/admin/billing-plans?archived=0')->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/admin/billing-plans?archived=1')->assertJsonPath('meta.total', 1);

        $this->postJson('/api/v1/admin/billing-plans/'.$plan->uuid.'/restore')
            ->assertOk()
            ->assertJsonPath('data.archived', false);
        $this->putJson('/api/v1/admin/billing-accounts/'.$other->uuid.'/plan', ['plan_uuid' => $plan->uuid])->assertOk();
    }

    public function test_only_a_plan_that_was_never_assigned_can_be_deleted(): void
    {
        $used = BillingPlan::factory()->create(['name' => 'A used plan']);
        $account = BillingAccount::factory()->onPlan($used)->create();
        $unused = BillingPlan::factory()->create(['name' => 'B unused plan']);
        $this->actingAs($this->administrator, 'sanctum');

        // Removing the plan does not make it deletable: it was assigned once.
        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/plan', ['plan_uuid' => null])->assertOk();
        $this->getJson('/api/v1/admin/billing-plans')
            ->assertJsonPath('data.0.ever_assigned', true)
            ->assertJsonPath('data.0.accounts_count', 0);
        $this->deleteJson('/api/v1/admin/billing-plans/'.$used->uuid)
            ->assertConflict()
            ->assertJsonPath('message', 'This plan has been assigned to a billing account, so it cannot be deleted. Archive it instead.');

        $this->deleteJson('/api/v1/admin/billing-plans/'.$unused->uuid)->assertNoContent();
        $this->assertModelMissing($unused);
        $this->assertSame(1, DB::table('activity_log')->where('event', 'billing_plan.deleted')->where('subject_uuid', $unused->uuid)->count());
    }

    public function test_plans_are_listed_and_searched_with_their_account_counts(): void
    {
        $growth = BillingPlan::factory()->withAllowances(['devices' => 50])->create(['name' => 'Growth']);
        BillingPlan::factory()->create(['name' => 'Starter']);
        BillingAccount::factory()->count(3)->onPlan($growth)->create();

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson('/api/v1/admin/billing-plans?search=gro')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.name', 'Growth')
            ->assertJsonPath('data.0.accounts_count', 3)
            ->assertJsonPath('data.0.allowances', [['kind' => 'devices', 'value' => 50]]);
        $this->getJson('/api/v1/admin/billing-plans/'.$growth->uuid)
            ->assertOk()
            ->assertJsonCount(3, 'data.accounts');
    }

    public function test_plan_routes_are_refused_without_the_manage_organizations_permission(): void
    {
        $plan = BillingPlan::factory()->create();
        $account = BillingAccount::factory()->create();
        // A platform administrator who may open the admin app and manage retention, but not organizations.
        $this->seed(PermissionSeeder::class);
        $role = PlatformRole::query()->create(['key' => 'retention-keeper', 'display_name' => 'Retention keeper', 'is_system' => false]);
        $role->permissions()->sync(Permission::query()->whereIn('name', [PlatformAdministrationPermission::ACCESS->value, PlatformAdministrationPermission::MANAGE_RETENTION->value])->pluck('id'));
        $keeper = User::factory()->create();
        $keeper->platformRoles()->attach($role->id);

        // The session tells the admin app to hide Plans and the other billing pages (spec 028 US1/AC6).
        $this->actingAs($this->administrator, 'sanctum')->getJson('/api/v1/me')->assertJsonPath('data.capabilities.manage_organizations', true);
        $this->actingAs($keeper, 'sanctum')
            ->getJson('/api/v1/me')
            ->assertJsonPath('data.capabilities.platform_administration', true)
            ->assertJsonPath('data.capabilities.manage_retention', true)
            ->assertJsonPath('data.capabilities.manage_organizations', false);

        $this->getJson('/api/v1/admin/billing-plans')->assertForbidden();
        $this->postJson('/api/v1/admin/billing-plans', ['name' => 'Growth'])->assertForbidden();
        $this->getJson('/api/v1/admin/billing-plans/'.$plan->uuid)->assertForbidden();
        $this->patchJson('/api/v1/admin/billing-plans/'.$plan->uuid, ['name' => 'Other'])->assertForbidden();
        $this->postJson('/api/v1/admin/billing-plans/'.$plan->uuid.'/archive')->assertForbidden();
        $this->deleteJson('/api/v1/admin/billing-plans/'.$plan->uuid)->assertForbidden();
        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/plan', ['plan_uuid' => $plan->uuid])->assertForbidden();
        $this->putJson('/api/v1/admin/billing-accounts/'.$account->uuid.'/allowances/devices', ['value' => 5, 'note' => 'x'])->assertForbidden();
        $this->assertSame(0, $account->planAssignments()->count());
    }
}
