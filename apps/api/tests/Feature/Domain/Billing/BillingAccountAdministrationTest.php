<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * Platform administrators create organizations under billing accounts and manage the
 * accounts (spec 023 US1 and US2).
 */
final class BillingAccountAdministrationTest extends TestCase
{
    use AssertsBillingAssignments, RefreshDatabase;

    private User $administrator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->administrator = User::factory()->create(['name' => 'Platform Admin', 'is_super_admin' => true]);
    }

    public function test_an_organization_is_created_together_with_a_new_billing_account(): void
    {
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', [
                'name' => 'Corner Shop',
                'slug' => 'corner-shop',
                'new_billing_account' => ['name' => 'Corner Shop Billing', 'contact_email' => 'billing@example.com'],
            ])
            ->assertCreated()
            ->assertJsonPath('data.slug', 'corner-shop')
            ->assertJsonPath('data.billing_account.name', 'Corner Shop Billing');

        $organization = Organization::query()->where('slug', 'corner-shop')->firstOrFail();
        $account = $organization->billingAccount;
        $this->assertSame('billing@example.com', $account->contact_email);
        $this->assertSame(1, $account->organization_limit);
        $this->assertSame($this->administrator->id, (int) DB::table('billing_account_assignments')->where('organization_id', $organization->id)->value('assigned_by'));
        $this->assertSame(1, $this->auditCount('billing_account.created', $account->uuid));
        $this->assertBillingAssignmentInvariants($organization);
    }

    public function test_an_organization_can_join_an_existing_billing_account_even_at_its_limit(): void
    {
        $account = BillingAccount::factory()->create(['name' => 'Example Integrations']);
        Organization::factory()->forBillingAccount($account)->create();

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', ['name' => 'Lakeside Home', 'slug' => 'lakeside-home', 'billing_account_uuid' => $account->uuid])
            ->assertCreated()
            ->assertJsonPath('data.billing_account.uuid', $account->uuid);

        $this->assertSame(2, $account->organizations()->count());
        $this->assertSame(1, BillingAccount::query()->count());
    }

    public function test_an_api_client_that_names_no_account_gets_one_named_after_the_organization(): void
    {
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', ['name' => 'Harbour Depot', 'slug' => 'harbour-depot'])
            ->assertCreated()
            ->assertJsonPath('data.billing_account.name', 'Harbour Depot');

        $account = Organization::query()->where('slug', 'harbour-depot')->firstOrFail()->billingAccount;
        $this->getJson('/api/v1/admin/billing-accounts/'.$account->uuid)
            ->assertOk()
            ->assertJsonPath('data.history.0.action', 'organization_joined')
            ->assertJsonPath('data.history.1.action', 'created')
            ->assertJsonPath('data.history.1.actor.id', $this->administrator->id);
    }

    public function test_creating_with_both_an_existing_and_a_new_account_is_refused_with_422(): void
    {
        $account = BillingAccount::factory()->create();

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', [
                'name' => 'Corner Shop',
                'slug' => 'corner-shop',
                'billing_account_uuid' => $account->uuid,
                'new_billing_account' => ['name' => 'Corner Shop'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['billing_account_uuid' => 'Choose an existing billing account or a new one, not both.']);

        $this->assertFalse(Organization::query()->where('slug', 'corner-shop')->exists());
    }

    public function test_an_unknown_or_deleted_billing_account_is_refused_with_422(): void
    {
        $deleted = BillingAccount::factory()->create();
        $deleted->delete();

        foreach ([(string) Str::uuid(), $deleted->uuid] as $uuid) {
            $this->actingAs($this->administrator, 'sanctum')
                ->postJson('/api/v1/admin/organizations', ['name' => 'Corner Shop', 'slug' => 'corner-shop', 'billing_account_uuid' => $uuid])
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['billing_account_uuid' => 'That billing account no longer exists.']);
        }
    }

    public function test_a_failure_after_the_new_account_rolls_both_back(): void
    {
        Event::listen('eloquent.created: '.Organization::class, fn () => throw new RuntimeException('Creation failed.'));
        $this->withoutExceptionHandling();

        try {
            $this->actingAs($this->administrator, 'sanctum')->postJson('/api/v1/admin/organizations', [
                'name' => 'Corner Shop',
                'slug' => 'corner-shop',
                'new_billing_account' => ['name' => 'Corner Shop Billing'],
            ]);
            $this->fail('The creation should have failed.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Creation failed.', $exception->getMessage());
        }

        $this->assertFalse(Organization::query()->where('slug', 'corner-shop')->exists());
        $this->assertFalse(BillingAccount::withTrashed()->where('name', 'Corner Shop Billing')->exists());
    }

    public function test_the_organization_list_shows_each_billing_account_and_members_never_see_theirs(): void
    {
        $account = BillingAccount::factory()->create(['name' => 'Example Integrations']);
        $organization = Organization::factory()->forBillingAccount($account)->create(['name' => 'Corner Shop']);
        $member = User::factory()->create();
        $member->organizations()->attach($organization);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson('/api/v1/admin/organizations?search=Corner')
            ->assertOk()
            ->assertJsonPath('data.0.billing_account', ['uuid' => $account->uuid, 'name' => 'Example Integrations']);

        $this->actingAs($member, 'sanctum')
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.organizations.0.uuid', $organization->uuid)
            ->assertJsonMissingPath('data.organizations.0.billing_account');
        $this->getJson('/api/v1/organizations/'.$organization->uuid.'/context')
            ->assertOk()
            ->assertJsonMissingPath('data.billing_account');
    }

    public function test_billing_accounts_are_listed_with_counts_and_owners_and_searchable(): void
    {
        $owner = User::factory()->create(['name' => 'Pat Example', 'email' => 'pat@example.com']);
        $integrations = BillingAccount::factory()->limit(10)->ownedBy($owner)->create(['name' => 'Example Integrations', 'contact_email' => 'billing@example.com']);
        Organization::factory()->count(2)->forBillingAccount($integrations)->create();
        BillingAccount::factory()->create(['name' => 'Harbour Depot', 'contact_email' => 'accounts@example.net']);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson('/api/v1/admin/billing-accounts?per_page=1')
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.name', 'Example Integrations')
            ->assertJsonPath('data.0.organizations_count', 2)
            ->assertJsonPath('data.0.organization_limit', 10)
            ->assertJsonPath('data.0.owners.0.id', $owner->id)
            ->assertJsonPath('data.0.owners.0.email', 'pat@example.com');

        $this->getJson('/api/v1/admin/billing-accounts?search=example.net')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.name', 'Harbour Depot');
        $this->getJson('/api/v1/admin/billing-accounts?search=INTEGRATIONS')
            ->assertOk()
            ->assertJsonPath('meta.total', 1);
    }

    public function test_billing_account_routes_are_refused_without_the_manage_organizations_permission(): void
    {
        $account = BillingAccount::factory()->create();
        $organization = Organization::factory()->create();
        $this->actingAs(User::factory()->create(), 'sanctum');

        $this->getJson('/api/v1/admin/billing-accounts')->assertForbidden();
        $this->getJson('/api/v1/admin/billing-accounts/'.$account->uuid)->assertForbidden();
        $this->putJson('/api/v1/admin/organizations/'.$organization->uuid.'/billing-account', ['billing_account_uuid' => $account->uuid])->assertForbidden();
        $this->assertSame($organization->billing_account_id, $organization->fresh()->billing_account_id);
    }

    public function test_a_billing_account_is_created_with_validation_and_an_audit_event(): void
    {
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson('/api/v1/admin/billing-accounts', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name' => 'The name field is required.']);
        $this->postJson('/api/v1/admin/billing-accounts', ['name' => 'Example Integrations', 'organization_limit' => 1001])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['organization_limit' => 'The organization limit field must not be greater than 1000.']);

        $uuid = $this->postJson('/api/v1/admin/billing-accounts', [
            'name' => 'Example Integrations',
            'contact_email' => 'billing@example.com',
            'notes' => 'Invoiced quarterly.',
            'organization_limit' => 5,
        ])
            ->assertCreated()
            ->assertJsonPath('data.organization_limit', 5)
            ->assertJsonPath('data.organizations', [])
            ->assertJsonPath('data.history.0.action', 'created')
            ->assertJsonPath('data.history.0.actor', ['id' => $this->administrator->id, 'name' => 'Platform Admin'])
            ->json('data.uuid');

        $this->assertSame(1, $this->auditCount('billing_account.created', $uuid));
    }

    public function test_the_account_page_lists_owners_organizations_and_history_newest_first(): void
    {
        $owner = User::factory()->create(['name' => 'Pat Example']);
        $account = BillingAccount::factory()->ownedBy($owner)->create(['name' => 'Example Integrations']);
        $organization = Organization::factory()->forBillingAccount($account)->create(['name' => 'Corner Shop', 'slug' => 'corner-shop']);
        $organization->users()->attach(User::factory()->count(2)->create());

        $this->travel(1)->minutes();
        $this->actingAs($this->administrator, 'sanctum')
            ->patchJson('/api/v1/admin/billing-accounts/'.$account->uuid, ['organization_limit' => 3])
            ->assertOk();

        $this->getJson('/api/v1/admin/billing-accounts/'.$account->uuid)
            ->assertOk()
            ->assertJsonPath('data.organizations_count', 1)
            ->assertJsonPath('data.owners.0.name', 'Pat Example')
            ->assertJsonPath('data.organizations.0.slug', 'corner-shop')
            ->assertJsonPath('data.organizations.0.users_count', 2)
            ->assertJsonPath('data.organizations.0.devices_count', 0)
            ->assertJsonPath('data.history.0.action', 'updated')
            ->assertJsonPath('data.history.0.changes', [['field' => 'organization_limit', 'from' => '1', 'to' => '3']])
            ->assertJsonPath('data.history.1.action', 'organization_joined')
            ->assertJsonPath('data.history.1.actor', null)
            ->assertJsonPath('data.history.1.organization', ['uuid' => $organization->uuid, 'name' => 'Corner Shop']);
    }

    public function test_the_history_shows_the_latest_100_entries(): void
    {
        $account = BillingAccount::factory()->create();

        for ($minute = 1; $minute <= 101; $minute++) {
            $this->travel(1)->minutes();
            DeviceAudit::record('billing_account.updated', null, $this->administrator->id, $account->uuid, [
                'changes' => ['notes' => ['from' => null, 'to' => "Note {$minute}"]],
            ]);
        }

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson('/api/v1/admin/billing-accounts/'.$account->uuid)
            ->assertOk()
            ->assertJsonCount(100, 'data.history')
            ->assertJsonPath('data.history.0.changes.0.to', 'Note 101')
            ->assertJsonPath('data.history.99.changes.0.to', 'Note 2');
    }

    public function test_an_update_audits_only_changed_fields_and_may_set_the_limit_below_the_count(): void
    {
        $account = BillingAccount::factory()->limit(3)->create(['name' => 'Example Integrations']);
        Organization::factory()->count(2)->forBillingAccount($account)->create();

        $this->actingAs($this->administrator, 'sanctum')
            ->patchJson('/api/v1/admin/billing-accounts/'.$account->uuid, ['name' => 'Example Integrations', 'organization_limit' => 1])
            ->assertOk()
            ->assertJsonPath('data.organization_limit', 1)
            ->assertJsonPath('data.organizations_count', 2);
        $this->patchJson('/api/v1/admin/billing-accounts/'.$account->uuid, ['organization_limit' => 1])->assertOk();

        $details = json_decode((string) DB::table('device_audit_events')->where('resource_uuid', $account->uuid)->where('action', 'billing_account.updated')->sole()->details, true);
        $this->assertSameJsonDocument(['organization_limit' => ['from' => 3, 'to' => 1]], $details['changes']);
    }

    public function test_only_an_empty_billing_account_can_be_deleted(): void
    {
        $busy = BillingAccount::factory()->create();
        Organization::factory()->count(2)->forBillingAccount($busy)->create();
        $empty = BillingAccount::factory()->create();

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson('/api/v1/admin/billing-accounts/'.$busy->uuid)
            ->assertConflict()
            ->assertJsonPath('message', "Move this billing account's 2 organizations before deleting it.");
        $this->deleteJson('/api/v1/admin/billing-accounts/'.$empty->uuid)->assertNoContent();

        $this->assertSoftDeleted($empty);
        $this->assertSame(1, $this->auditCount('billing_account.deleted', $empty->uuid));
        $this->getJson('/api/v1/admin/billing-accounts/'.$empty->uuid)->assertNotFound();
        $this->getJson('/api/v1/admin/billing-accounts')->assertJsonPath('meta.total', 1);
    }

    public function test_owners_are_added_and_removed_once_without_touching_memberships(): void
    {
        $account = BillingAccount::factory()->create();
        $organization = Organization::factory()->forBillingAccount($account)->create();
        $owner = User::factory()->create(['name' => 'Pat Example']);
        $owner->organizations()->attach($organization);

        $this->actingAs($this->administrator, 'sanctum')
            ->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/owners/{$owner->id}")
            ->assertOk()
            ->assertJsonPath('data.0.id', $owner->id)
            ->assertJsonPath('data.0.name', 'Pat Example');
        $this->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/owners/{$owner->id}")->assertOk()->assertJsonCount(1, 'data');
        $this->putJson("/api/v1/admin/billing-accounts/{$account->uuid}/owners/999999")->assertNotFound();

        $this->deleteJson("/api/v1/admin/billing-accounts/{$account->uuid}/owners/{$owner->id}")->assertNoContent();
        $this->deleteJson("/api/v1/admin/billing-accounts/{$account->uuid}/owners/{$owner->id}")->assertNoContent();

        $this->assertSame(1, $this->auditCount('billing_account.owner_added', $account->uuid));
        $this->assertSame(1, $this->auditCount('billing_account.owner_removed', $account->uuid));
        $this->assertFalse($account->owners()->exists());
        $this->assertTrue($owner->organizations()->whereKey($organization->id)->exists());
    }

    public function test_moving_an_organization_changes_only_its_billing_account(): void
    {
        $from = BillingAccount::factory()->create(['name' => 'Corner Shop']);
        $to = BillingAccount::factory()->create(['name' => 'Example Integrations']);
        Organization::factory()->forBillingAccount($to)->create();
        $organization = Organization::factory()->forBillingAccount($from)->create();
        $organization->users()->attach(User::factory()->create());
        $before = $this->rowsInOrganization($organization);

        $this->travel(1)->minutes();
        $this->actingAs($this->administrator, 'sanctum')
            ->putJson('/api/v1/admin/organizations/'.$organization->uuid.'/billing-account', ['billing_account_uuid' => $to->uuid])
            ->assertNoContent();

        $this->assertSame($to->id, $organization->fresh()->billing_account_id);
        $this->assertSame($before, $this->rowsInOrganization($organization));
        $this->assertBillingAssignmentInvariants($organization);
        $closed = DB::table('billing_account_assignments')->where('billing_account_id', $from->id)->sole();
        $this->assertSame($this->administrator->id, (int) $closed->ended_by);
        $audit = json_decode((string) DB::table('device_audit_events')->where('resource_uuid', $organization->uuid)->where('action', 'organization.billing_account_changed')->sole()->details, true);
        $this->assertSameJsonDocument(['from' => ['uuid' => $from->uuid, 'name' => 'Corner Shop'], 'to' => ['uuid' => $to->uuid, 'name' => 'Example Integrations']], $audit);

        $this->getJson('/api/v1/admin/billing-accounts/'.$from->uuid)
            ->assertJsonPath('data.history.0.action', 'organization_left')
            ->assertJsonPath('data.history.0.actor.id', $this->administrator->id);

        $this->putJson('/api/v1/admin/organizations/'.$organization->uuid.'/billing-account', ['billing_account_uuid' => $to->uuid])->assertNoContent();
        $this->assertSame(2, DB::table('billing_account_assignments')->where('organization_uuid', $organization->uuid)->count());
    }

    private function auditCount(string $action, string $resource): int
    {
        return DB::table('device_audit_events')->where('action', $action)->where('resource_uuid', $resource)->count();
    }

    /**
     * Rows that belong to the organization in every table keyed by it, apart from the
     * billing assignments a move writes on purpose.
     *
     * @return array<string, int>
     */
    private function rowsInOrganization(Organization $organization): array
    {
        $counts = [];

        foreach (Schema::getTableListing(schemaQualified: false) as $table) {
            if ($table !== 'billing_account_assignments' && Schema::hasColumn($table, 'organization_id')) {
                $counts[$table] = DB::table($table)->where('organization_id', $organization->id)->count();
            }
        }

        $counts['organization'] = DB::table('organizations')->where('id', $organization->id)->where('uuid', $organization->uuid)->where('slug', $organization->slug)->count();

        return $counts;
    }
}
