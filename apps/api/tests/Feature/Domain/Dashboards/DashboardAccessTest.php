<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Authorization\Models\Role;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Dashboards\Services\DashboardPermissionBackfill;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

final class DashboardAccessTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $url;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->url = '/api/v1/organizations/'.$this->organization->uuid.'/dashboards';
    }

    public function test_built_in_roles_get_dashboard_capabilities_of_their_own(): void
    {
        $expected = [
            'shared.operator@example.test' => ['view' => true, 'create' => true, 'manage' => true],
            'acme.moderator@example.test' => ['view' => true, 'create' => true, 'manage' => false],
            'acme.member@example.test' => ['view' => true, 'create' => false, 'manage' => false],
        ];
        foreach ($expected as $email => $capabilities) {
            $this->actAs($email);
            $organization = collect($this->getJson('/api/v1/me')->assertOk()->json('data.organizations'))->firstWhere('uuid', $this->organization->uuid);
            $this->assertSame($capabilities, $organization['capabilities']['dashboards'], $email);
        }
    }

    public function test_owners_restrict_and_share_while_managers_keep_full_access(): void
    {
        $this->actAs('acme.moderator@example.test');
        $created = $this->postJson($this->url, $this->dashboard())->assertOk()
            ->assertJsonPath('data.access', 'organization')
            ->assertJsonPath('data.abilities', ['edit' => true, 'share' => true, 'delete' => true])
            ->json('data');
        $path = $this->url.'/'.$created['uuid'];
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();

        // Open to the organization: members read it but cannot change or share it.
        $this->actAs('acme.member@example.test');
        $this->getJson($this->url)->assertOk()->assertJsonPath('data.0.abilities', ['edit' => false, 'share' => false, 'delete' => false]);
        $this->getJson($path)->assertOk();
        $this->putJson($path, [...$this->dashboard(), 'revision' => 1])->assertForbidden();
        $this->getJson($path.'/access')->assertForbidden();
        $this->deleteJson($path)->assertForbidden();

        // Restricted: gone from the member's library and closed to them.
        $this->actAs('acme.moderator@example.test');
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => []])->assertOk()
            ->assertJsonPath('data.access', 'restricted')->assertJsonPath('data.owner.name', 'Acme Moderator');
        $this->actAs('acme.member@example.test');
        $this->getJson($this->url)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($path)->assertForbidden()->assertJsonPath('message', "You don't have access to this dashboard.");
        $this->putJson($path.'/star', ['starred' => true])->assertForbidden();

        // Shared to view, then to edit: editing never includes sharing or deleting.
        $this->actAs('acme.moderator@example.test');
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => [['type' => 'user', 'id' => $member->id, 'level' => 'view']]])->assertOk()
            ->assertJsonPath('data.shares.0', ['type' => 'user', 'id' => $member->id, 'name' => 'Acme Member', 'detail' => 'acme.member@example.test', 'level' => 'view']);
        $this->actAs('acme.member@example.test');
        $this->getJson($path)->assertOk()->assertJsonPath('data.abilities.edit', false);
        $this->putJson($path, [...$this->dashboard(), 'revision' => 1])->assertForbidden();
        $this->actAs('acme.moderator@example.test');
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => [['type' => 'user', 'id' => $member->id, 'level' => 'edit']]])->assertOk();
        $this->actAs('acme.member@example.test');
        $this->putJson($path, [...$this->dashboard('Edited by member'), 'revision' => 1])->assertOk()->assertJsonPath('data.name', 'Edited by member');
        $this->postJson($path.'/revisions/1/restore', ['revision' => 2])->assertOk();
        $this->getJson($path.'/access')->assertForbidden();
        $this->deleteJson($path)->assertForbidden();

        // A role share reaches everyone holding the role.
        $memberRole = Role::where('organization_id', $this->organization->id)->where('name', 'member')->firstOrFail();
        $this->actAs('acme.moderator@example.test');
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => [['type' => 'role', 'id' => $memberRole->id, 'level' => 'view']]])->assertOk()
            ->assertJsonPath('data.shares.0.type', 'role')->assertJsonPath('data.shares.0.name', 'Member');
        $this->actAs('acme.member@example.test');
        $this->getJson($this->url)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($path)->assertOk()->assertJsonPath('data.abilities.edit', false);

        // Dashboard managers open, edit, share and delete every dashboard.
        $this->actAs('shared.operator@example.test');
        $this->getJson($path)->assertOk()->assertJsonPath('data.abilities', ['edit' => true, 'share' => true, 'delete' => true]);
        $this->getJson($path.'/access')->assertOk()->assertJsonCount(1, 'data.shares');
        $this->deleteJson($path)->assertNoContent();
        $this->assertDatabaseCount('dashboard_shares', 0);
    }

    public function test_shares_stay_inside_the_organization(): void
    {
        $this->actAs('acme.moderator@example.test');
        $created = $this->postJson($this->url, $this->dashboard())->assertOk()->json('data');
        $path = $this->url.'/'.$created['uuid'];
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreignRole = Role::where('organization_id', $northstar->id)->firstOrFail();
        $outsider = User::where('email', 'northstar.member@example.test')->firstOrFail();
        $moderator = User::where('email', 'acme.moderator@example.test')->firstOrFail();

        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => [['type' => 'role', 'id' => $foreignRole->id, 'level' => 'view']]])
            ->assertUnprocessable()->assertJsonValidationErrors('shares');
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => [['type' => 'user', 'id' => $outsider->id, 'level' => 'view']]])
            ->assertUnprocessable()->assertJsonValidationErrors('shares');
        $this->putJson($path.'/access', ['access' => 'everyone', 'shares' => []])->assertUnprocessable()->assertJsonValidationErrors('access');
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => [['type' => 'user', 'id' => $moderator->id, 'level' => 'owner']]])
            ->assertUnprocessable()->assertJsonValidationErrors('shares.0.level');
        // The owner already has full access; a share for them is dropped.
        $this->putJson($path.'/access', ['access' => 'restricted', 'shares' => [['type' => 'user', 'id' => $moderator->id, 'level' => 'view']]])
            ->assertOk()->assertJsonCount(0, 'data.shares');

        $targets = $this->getJson('/api/v1/organizations/'.$this->organization->uuid.'/dashboard-share-targets?search=acme')->assertOk()->json('data');
        $this->assertContains('Acme Member', array_column($targets['users'], 'name'));
        $this->assertNotContains('Northstar Member', array_column($targets['users'], 'name'));
        $this->actAs('acme.member@example.test');
        $this->getJson('/api/v1/organizations/'.$this->organization->uuid.'/dashboard-share-targets')->assertForbidden();
    }

    public function test_a_copy_keeps_the_original_audience(): void
    {
        $this->actAs('acme.moderator@example.test');
        $created = $this->postJson($this->url, $this->dashboard())->assertOk()->json('data');
        $memberRole = Role::where('organization_id', $this->organization->id)->where('name', 'member')->firstOrFail();
        $this->putJson($this->url.'/'.$created['uuid'].'/access', ['access' => 'restricted', 'shares' => [['type' => 'role', 'id' => $memberRole->id, 'level' => 'view']]])->assertOk();

        $copy = $this->postJson($this->url.'/'.$created['uuid'].'/duplicate', ['name' => 'Copy'])->assertOk()
            ->assertJsonPath('data.access', 'restricted')->json('data');
        $this->getJson($this->url.'/'.$copy['uuid'].'/access')->assertOk()
            ->assertJsonPath('data.shares.0.id', $memberRole->id)->assertJsonPath('data.owner.name', 'Acme Moderator');

        // Viewing is not enough to make copies.
        $this->actAs('acme.member@example.test');
        $this->postJson($this->url.'/'.$created['uuid'].'/duplicate', ['name' => 'Mine'])->assertForbidden();
    }

    public function test_upgrades_carry_device_grants_over_to_dashboards(): void
    {
        $registrar = app(PermissionRegistrar::class);
        $registrar->setPermissionsTeamId($this->organization->id);
        $custom = Role::create(['name' => 'line-lead', 'display_name' => 'Line lead', 'guard_name' => 'web', 'organization_id' => $this->organization->id, 'is_default' => false]);
        $custom->givePermissionTo('Device.manage');
        $direct = User::factory()->create();
        $this->organization->users()->attach($direct);
        $direct->givePermissionTo('Device.view');
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $northstar->update(['permissions_restricted' => true]);
        $northstar->permissions()->sync(Permission::whereIn('name', ['Device.view', 'Organization.view'])->where('guard_name', 'web')->pluck('id'));
        $registrar->setPermissionsTeamId(null);
        $registrar->forgetCachedPermissions();

        app(DashboardPermissionBackfill::class)->run();

        $registrar->setPermissionsTeamId($this->organization->id);
        $this->assertTrue($custom->fresh()->hasPermissionTo('Dashboard.create'), 'custom create');
        $this->assertTrue($custom->fresh()->hasPermissionTo('Dashboard.manage'), 'custom manage');
        $this->assertFalse($custom->fresh()->hasPermissionTo('Dashboard.view'), 'Device.manage alone did not let this role view devices either');
        $this->assertTrue(DB::table('model_has_permissions')->where('model_id', $direct->id)
            ->where('permission_id', Permission::where('name', 'Dashboard.view')->where('guard_name', 'web')->value('id'))->exists(), 'direct view');
        $this->assertSame(['Dashboard.view', 'Device.view', 'Organization.view'], $northstar->permissions()->pluck('name')->sort()->values()->all());
    }

    private function actAs(string $email): void
    {
        $this->actingAs(User::where('email', $email)->firstOrFail(), 'sanctum');
    }

    private function dashboard(string $name = 'Line 2'): array
    {
        return ['name' => $name, 'widgets' => [], 'layouts' => [], 'defaults' => DashboardDefinition::defaults()];
    }
}
