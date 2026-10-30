<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Billing account owners see their accounts and create organizations under them in the
 * portal (spec 023 US3). Owning an account grants no access to its organizations.
 */
final class BillingAccountOwnerTest extends TestCase
{
    use AssertsBillingAssignments, RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::factory()->create(['name' => 'Pat Example']);
    }

    public function test_an_owner_lists_only_their_accounts_and_which_organizations_they_belong_to(): void
    {
        $account = BillingAccount::factory()->limit(10)->ownedBy($this->owner)->create(['name' => 'Example Integrations']);
        $shop = Organization::factory()->forBillingAccount($account)->create(['name' => 'Corner Shop']);
        Organization::factory()->forBillingAccount($account)->create(['name' => 'Lakeside Home']);
        $this->owner->organizations()->attach($shop);
        BillingAccount::factory()->ownedBy(User::factory()->create())->create(['name' => 'Someone Else']);

        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/billing-accounts')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.uuid', $account->uuid)
            ->assertJsonPath('data.0.organization_limit', 10)
            ->assertJsonPath('data.0.organizations_count', 2)
            ->assertJsonPath('data.0.organizations.0.name', 'Corner Shop')
            ->assertJsonPath('data.0.organizations.0.member', true)
            ->assertJsonPath('data.0.organizations.1.name', 'Lakeside Home')
            ->assertJsonPath('data.0.organizations.1.member', false);
    }

    public function test_an_owner_below_the_limit_creates_an_organization_and_becomes_its_admin(): void
    {
        Notification::fake();
        $account = BillingAccount::factory()->limit(2)->ownedBy($this->owner)->create();

        $uuid = $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Lakeside Café'])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Lakeside Café')
            ->assertJsonPath('data.slug', 'lakeside-cafe')
            ->json('data.uuid');

        $organization = Organization::query()->where('uuid', $uuid)->firstOrFail();
        $this->assertSame($account->id, $organization->billing_account_id);
        $this->assertSame(['member', 'moderator', 'organization-admin'], Role::query()->where('organization_id', $organization->id)->orderBy('name')->pluck('name')->all());
        $this->assertTrue($this->holdsRole($this->owner, $organization, OrganizationRoleName::ORGANIZATION_ADMIN));
        $this->assertSame($this->owner->id, (int) DB::table('billing_account_assignments')->where('organization_id', $organization->id)->value('assigned_by'));
        $this->assertBillingAssignmentInvariants($organization);
        Notification::assertNothingSent();

        $this->getJson('/api/v1/organizations/'.$uuid.'/context')->assertOk();
    }

    public function test_creation_at_the_limit_is_refused_with_a_message_naming_it(): void
    {
        $account = BillingAccount::factory()->limit(1)->ownedBy($this->owner)->create();
        Organization::factory()->forBillingAccount($account)->create();

        $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Lakeside Café'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['billing_account' => 'This billing account allows 1 organization. Ask the platform operator to raise the limit.']);

        $this->assertSame(1, $account->organizations()->count());
    }

    public function test_a_platform_administrator_who_owns_the_account_is_bound_by_the_limit_here(): void
    {
        $administrator = User::factory()->create(['is_super_admin' => true]);
        $account = BillingAccount::factory()->limit(0)->ownedBy($administrator)->create();

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Lakeside Café'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['billing_account' => 'This billing account allows 0 organizations. Ask the platform operator to raise the limit.']);
    }

    public function test_a_suggested_address_skips_taken_ones_and_a_chosen_taken_one_is_refused(): void
    {
        $account = BillingAccount::factory()->limit(5)->ownedBy($this->owner)->create();
        Organization::factory()->create(['slug' => 'lakeside-cafe'])->delete();

        $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Lakeside Café'])
            ->assertCreated()
            ->assertJsonPath('data.slug', 'lakeside-cafe-2');
        $this->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Lakeside Café', 'slug' => 'my-cafe'])
            ->assertCreated()
            ->assertJsonPath('data.slug', 'my-cafe');
        $this->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Another Café', 'slug' => 'my-cafe'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['slug' => 'The slug has already been taken.']);
    }

    public function test_an_account_the_person_does_not_own_answers_404(): void
    {
        $someoneElses = BillingAccount::factory()->limit(5)->ownedBy(User::factory()->create())->create();
        $removed = BillingAccount::factory()->limit(5)->ownedBy($this->owner)->create();
        $removed->owners()->detach($this->owner);
        $deleted = BillingAccount::factory()->limit(5)->ownedBy($this->owner)->create();
        $deleted->delete();

        $this->actingAs($this->owner, 'sanctum');

        foreach ([$someoneElses->uuid, $removed->uuid, $deleted->uuid, (string) Str::uuid()] as $uuid) {
            $this->postJson("/api/v1/billing-accounts/{$uuid}/organizations", ['name' => 'Lakeside Café'])->assertNotFound();
        }

        $this->getJson('/api/v1/billing-accounts')->assertOk()->assertJsonCount(0, 'data');
        $this->assertSame(0, Organization::query()->where('name', 'Lakeside Café')->count());
    }

    public function test_owner_creation_locks_the_account_while_it_checks_the_limit(): void
    {
        $account = BillingAccount::factory()->limit(2)->ownedBy($this->owner)->create();
        Organization::factory()->forBillingAccount($account)->create();
        $this->actingAs($this->owner, 'sanctum');

        DB::enableQueryLog();
        $this->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Lakeside Café'])->assertCreated();
        $locks = collect(DB::getQueryLog())->pluck('query')->filter(fn (string $sql): bool => str_contains($sql, 'from "billing_accounts"') && str_contains($sql, 'for update'));
        DB::disableQueryLog();

        $this->postJson("/api/v1/billing-accounts/{$account->uuid}/organizations", ['name' => 'Harbour Depot'])->assertUnprocessable();

        // RefreshDatabase keeps the test on one connection inside one transaction, so two
        // truly parallel requests cannot run here; the row lock is what serializes them.
        if (DB::getDriverName() === 'pgsql') {
            $this->assertCount(1, $locks);
        }
        $this->assertSame(2, $account->organizations()->count());
    }

    public function test_owning_an_account_grants_no_access_to_its_organizations(): void
    {
        $account = BillingAccount::factory()->limit(5)->ownedBy($this->owner)->create();
        $organization = Organization::factory()->forBillingAccount($account)->create();

        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/organizations/'.$organization->uuid.'/context')
            ->assertForbidden();
        $this->getJson('/api/v1/organizations/'.$organization->uuid.'/devices')->assertForbidden();
        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.capabilities.billing_accounts', true)
            ->assertJsonPath('data.organizations', []);
    }

    public function test_the_session_reports_billing_accounts_only_to_current_owners(): void
    {
        $account = BillingAccount::factory()->ownedBy($this->owner)->create();

        $this->actingAs(User::factory()->create(), 'sanctum')
            ->getJson('/api/v1/me')
            ->assertJsonPath('data.capabilities.billing_accounts', false);

        $account->delete();
        $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/v1/me')
            ->assertJsonPath('data.capabilities.billing_accounts', false);
    }

    private function holdsRole(User $user, Organization $organization, OrganizationRoleName $name): bool
    {
        $role = Role::query()->where('organization_id', $organization->id)->where('name', $name->value)->firstOrFail();

        return DB::table(config('permission.table_names.model_has_roles'))
            ->where('role_id', $role->id)
            ->where('model_id', $user->id)
            ->exists();
    }
}
