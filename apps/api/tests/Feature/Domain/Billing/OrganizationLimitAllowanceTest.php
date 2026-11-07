<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The organization limit is the `organizations` allowance (spec 029 FR-004, FR-004a;
 * ADR-035, amending ADR-026): owners are still refused at it, platform administrators
 * are not bound by it, and rollout keeps every account's limit.
 */
final class OrganizationLimitAllowanceTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create(['name' => 'Pat Example']);
    }

    public function test_the_migration_keeps_raised_limits_as_overrides(): void
    {
        $migration = require database_path('migrations/2026_11_07_100000_create_billing_plans.php');
        $migration->down();

        $raised = DB::table('billing_accounts')->insertGetId(['uuid' => (string) str()->uuid(), 'name' => 'Raised', 'organization_limit' => 5, 'created_at' => now(), 'updated_at' => now()]);
        $default = DB::table('billing_accounts')->insertGetId(['uuid' => (string) str()->uuid(), 'name' => 'Default', 'organization_limit' => 1, 'created_at' => now(), 'updated_at' => now()]);

        $migration->up();

        $this->assertFalse(Schema::hasColumn('billing_accounts', 'organization_limit'));
        $this->assertSame(
            [['billing_account_id' => $raised, 'kind' => 'organizations', 'value' => 5, 'note' => 'Organization limit before plans']],
            DB::table('billing_allowance_overrides')->get(['billing_account_id', 'kind', 'value', 'note'])
                ->map(fn (object $row): array => ['billing_account_id' => (int) $row->billing_account_id, 'kind' => $row->kind, 'value' => (int) $row->value, 'note' => $row->note])
                ->all(),
        );
        $this->assertSame(0, DB::table('billing_allowance_overrides')->where('billing_account_id', $default)->count());
    }

    public function test_owners_are_refused_at_the_limit_from_the_plan(): void
    {
        $plan = BillingPlan::factory()->withAllowances(['organizations' => 2])->create();
        $account = BillingAccount::factory()->onPlan($plan)->ownedBy($this->owner)->create();
        Organization::factory()->count(2)->forBillingAccount($account)->create();

        $this->actingAs($this->owner, 'sanctum')
            ->postJson('/api/v1/billing-accounts/'.$account->uuid.'/organizations', ['name' => 'Third'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['billing_account' => 'This billing account allows 2 organizations. Ask the platform operator to raise the limit.']);
        $this->getJson('/api/v1/billing-accounts')->assertJsonPath('data.0.organization_limit', 2);
    }

    public function test_an_override_raises_the_plan_limit_and_unlimited_never_refuses(): void
    {
        $plan = BillingPlan::factory()->withAllowances(['organizations' => 1])->create();
        $account = BillingAccount::factory()->onPlan($plan)->ownedBy($this->owner)->limit(null)->create();
        Organization::factory()->count(3)->forBillingAccount($account)->create();

        $this->actingAs($this->owner, 'sanctum')
            ->postJson('/api/v1/billing-accounts/'.$account->uuid.'/organizations', ['name' => 'Fourth'])
            ->assertCreated();
        $this->getJson('/api/v1/billing-accounts')->assertJsonPath('data.0.organization_limit', null);
    }

    public function test_the_default_limit_is_one(): void
    {
        $account = BillingAccount::factory()->ownedBy($this->owner)->create();

        $this->actingAs($this->owner, 'sanctum')
            ->postJson('/api/v1/billing-accounts/'.$account->uuid.'/organizations', ['name' => 'First'])
            ->assertCreated();
        $this->postJson('/api/v1/billing-accounts/'.$account->uuid.'/organizations', ['name' => 'Second'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['billing_account' => 'This billing account allows 1 organization. Ask the platform operator to raise the limit.']);
    }

    public function test_platform_administrators_are_not_bound_by_the_limit(): void
    {
        $administrator = User::factory()->create(['is_super_admin' => true]);
        $account = BillingAccount::factory()->limit(0)->create();

        $this->actingAs($administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', ['name' => 'Corner Shop', 'slug' => 'corner-shop', 'billing_account_uuid' => $account->uuid])
            ->assertCreated();
    }

    public function test_setting_the_limit_on_the_account_writes_or_removes_an_override(): void
    {
        $administrator = User::factory()->create(['is_super_admin' => true]);
        $plan = BillingPlan::factory()->withAllowances(['organizations' => 3])->create();
        $account = BillingAccount::factory()->onPlan($plan)->create();
        $this->actingAs($administrator, 'sanctum');

        $this->patchJson('/api/v1/admin/billing-accounts/'.$account->uuid, ['organization_limit' => 10])
            ->assertOk()
            ->assertJsonPath('data.organization_limit', 10)
            ->assertJsonPath('data.allowances.5.source', 'override');
        // The plan's own value removes the override, so later plan changes apply again.
        $this->patchJson('/api/v1/admin/billing-accounts/'.$account->uuid, ['organization_limit' => 3])
            ->assertOk()
            ->assertJsonPath('data.allowances.5.source', 'plan');
        $this->assertSame(0, $account->allowanceOverrides()->count());
    }

    /**
     * The down migration restores the column from overrides, so a rollback keeps limits.
     */
    public function test_the_down_migration_restores_limits_from_overrides(): void
    {
        $account = BillingAccount::factory()->limit(7)->create();
        $migration = require database_path('migrations/2026_11_07_100000_create_billing_plans.php');

        $migration->down();

        $this->assertSame(7, (int) DB::table('billing_accounts')->where('id', $account->id)->value('organization_limit'));
        $migration->up();
        $this->assertSame(7, (int) DB::table('billing_allowance_overrides')->where('billing_account_id', $account->id)->value('value'));
    }
}
