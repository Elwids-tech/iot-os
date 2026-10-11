<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Administration\Notifications\OrganizationInvitationNotification;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

final class OrganizationMemberAdministrationTest extends TestCase
{
    use RefreshDatabase;

    /** A partial administrator: manages people and roles, but holds no device management. */
    private const PEOPLE_LEAD = [
        'Organization.view', 'Device.view', 'Workflow.view', 'Dashboard.view', 'DeviceProfile.view-any', 'DeviceProfile.view',
        'User.view-any', 'User.create', 'User.update', 'User.delete',
        'Role.view-any', 'Role.create', 'Role.update', 'Role.delete',
    ];

    private Organization $organization;

    private User $administrator;

    private User $peopleLead;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();

        Notification::fake();
        $this->seed(DatabaseSeeder::class);

        $this->organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $this->administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $this->peopleLead = User::query()->where('email', 'acme.moderator@example.test')->firstOrFail();
        $this->member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();

        $role = Role::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'custom-people-lead',
            'display_name' => 'People Lead',
            'is_default' => false,
            'guard_name' => 'web',
        ]);
        $role->syncPermissions(self::PEOPLE_LEAD);
        $this->assignRoles($this->peopleLead, [$role]);
    }

    public function test_actors_can_only_assign_roles_within_their_own_permissions(): void
    {
        $this->actingAs($this->peopleLead, 'sanctum')
            ->putJson($this->url("members/{$this->member->id}"), ['role_ids' => [$this->role('organization-admin')->id]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role_ids');

        $this->actingAs($this->peopleLead, 'sanctum')
            ->putJson($this->url("members/{$this->member->id}"), ['role_ids' => [$this->role('moderator')->id]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role_ids' => 'Moderator includes permissions you cannot grant.']);

        $viewers = $this->actingAs($this->peopleLead, 'sanctum')
            ->postJson($this->url('roles'), ['display_name' => 'Viewers', 'permission_names' => ['Device.view', 'Organization.view']])
            ->assertCreated()
            ->json('data.id');

        $this->actingAs($this->peopleLead, 'sanctum')
            ->putJson($this->url("members/{$this->member->id}"), ['role_ids' => [$viewers]])
            ->assertOk()
            ->assertJsonPath('data.roles.0.display_name', 'Viewers');

        $this->actingAs($this->peopleLead, 'sanctum')
            ->postJson($this->url('invitations'), [
                'email' => 'escalation@example.test',
                'role_ids' => [$this->role('organization-admin')->id],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role_ids');

        // Organization administrators hold the whole ceiling, so they can promote others.
        $this->actingAs($this->administrator, 'sanctum')
            ->putJson($this->url("members/{$this->member->id}"), ['role_ids' => [$this->role('organization-admin')->id]])
            ->assertOk();
    }

    public function test_actors_cannot_change_or_remove_members_with_more_access(): void
    {
        $this->actingAs($this->peopleLead, 'sanctum')
            ->deleteJson($this->url("members/{$this->administrator->id}"))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('member');

        $this->actingAs($this->peopleLead, 'sanctum')
            ->putJson($this->url("members/{$this->administrator->id}"), ['role_ids' => [$this->role('member')->id]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role_ids');

        $this->actingAs($this->peopleLead, 'sanctum')
            ->deleteJson($this->url("members/{$this->member->id}"))
            ->assertNoContent();
    }

    public function test_actors_cannot_create_or_edit_roles_beyond_their_permissions(): void
    {
        $this->actingAs($this->peopleLead, 'sanctum')
            ->postJson($this->url('roles'), ['display_name' => 'Operators', 'permission_names' => ['Device.view', 'Device.manage']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('permission_names');

        $this->actingAs($this->peopleLead, 'sanctum')
            ->postJson($this->url('roles'), ['display_name' => 'Viewers', 'permission_names' => ['Device.view']])
            ->assertCreated()
            ->assertJsonPath('data.manageable', true);

        $peopleLeadRole = $this->role('custom-people-lead');
        $this->actingAs($this->peopleLead, 'sanctum')
            ->patchJson($this->url("roles/{$peopleLeadRole->id}"), [
                'display_name' => 'People Lead',
                'permission_names' => [...self::PEOPLE_LEAD, 'Device.manage'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('permission_names');

        $administratorRole = $this->role('organization-admin');
        $this->actingAs($this->peopleLead, 'sanctum')
            ->patchJson($this->url("roles/{$administratorRole->id}"), [
                'display_name' => 'Owners',
                'permission_names' => $administratorRole->permissions()->pluck('name')->all(),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role');

        $roles = collect($this->actingAs($this->peopleLead, 'sanctum')->getJson($this->url('roles'))->assertOk()->json('data'))->keyBy('key');
        $this->assertFalse($roles['organization-admin']['assignable']);
        $this->assertFalse($roles['organization-admin']['manageable']);
        $this->assertTrue($roles['organization-admin']['is_administrator']);
        $this->assertSame(1, $roles['organization-admin']['members_count']);
        $this->assertTrue($roles['member']['assignable']);
        $this->assertTrue($roles['custom-people-lead']['manageable']);

        $permissions = collect($this->actingAs($this->peopleLead, 'sanctum')->getJson($this->url('role-permissions'))->json('data'))->keyBy('name');
        $this->assertTrue($permissions['Device.view']['grantable']);
        $this->assertFalse($permissions['Device.manage']['grantable']);
    }

    public function test_member_directory_searches_and_reports_what_the_actor_can_manage(): void
    {
        $members = collect($this->actingAs($this->peopleLead, 'sanctum')
            ->getJson($this->url('members'))
            ->assertOk()
            ->json('data'))->keyBy('email');

        $this->assertFalse($members['shared.operator@example.test']['manageable']);
        $this->assertTrue($members['acme.member@example.test']['manageable']);
        $this->assertTrue($members['acme.moderator@example.test']['is_current_user']);
        $this->assertFalse($members['acme.member@example.test']['is_current_user']);

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson($this->url('members?search=moderator'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.email', 'acme.moderator@example.test');
    }

    public function test_invitations_can_be_listed_resent_and_revoked_while_open(): void
    {
        $uuid = $this->actingAs($this->administrator, 'sanctum')
            ->postJson($this->url('invitations'), ['email' => 'New.Person@Example.test', 'role_ids' => [$this->role('member')->id]])
            ->assertCreated()
            ->assertJsonPath('data.email', 'new.person@example.test')
            ->assertJsonPath('data.roles.0.display_name', 'Member')
            ->assertJsonPath('data.invited_by.name', $this->administrator->name)
            ->json('data.uuid');

        $this->actingAs($this->administrator, 'sanctum')
            ->getJson($this->url('invitations'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'pending')
            ->assertJsonPath('data.0.manageable', true);

        $invitation = OrganizationInvitation::query()->where('uuid', $uuid)->firstOrFail();
        $invitation->forceFill(['expires_at' => now()->subDay()])->save();
        $originalHash = $invitation->token_hash;

        $this->actingAs($this->administrator, 'sanctum')->getJson($this->url('invitations'))->assertJsonCount(0, 'data');
        $this->actingAs($this->administrator, 'sanctum')
            ->getJson($this->url('invitations?status=expired'))
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'expired');

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson($this->url("invitations/{$uuid}/resend"))
            ->assertOk()
            ->assertJsonPath('data.uuid', $uuid)
            ->assertJsonPath('data.status', 'pending');

        $this->assertNotSame($originalHash, $invitation->fresh()->token_hash);
        Notification::assertSentOnDemandTimes(OrganizationInvitationNotification::class, 2);

        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson($this->url("invitations/{$uuid}"))
            ->assertNoContent();
        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson($this->url("invitations/{$uuid}"))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('invitation');
        $this->actingAs($this->administrator, 'sanctum')
            ->postJson($this->url("invitations/{$uuid}/resend"))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('invitation');
    }

    public function test_actors_cannot_revoke_invitations_that_grant_more_than_they_hold(): void
    {
        $uuid = $this->actingAs($this->administrator, 'sanctum')
            ->postJson($this->url('invitations'), ['email' => 'owner@example.test', 'role_ids' => [$this->role('organization-admin')->id]])
            ->assertCreated()
            ->json('data.uuid');

        $this->actingAs($this->peopleLead, 'sanctum')
            ->getJson($this->url('invitations'))
            ->assertJsonPath('data.0.manageable', false);
        $this->actingAs($this->peopleLead, 'sanctum')
            ->deleteJson($this->url("invitations/{$uuid}"))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('invitation');
    }

    public function test_the_final_administrator_keeps_their_role(): void
    {
        $this->actingAs($this->administrator, 'sanctum')
            ->putJson($this->url("members/{$this->administrator->id}"), ['role_ids' => [$this->role('member')->id]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role_ids');

        $this->actingAs($this->administrator, 'sanctum')
            ->putJson($this->url("members/{$this->member->id}"), ['role_ids' => [$this->role('organization-admin')->id]])
            ->assertOk();

        $this->actingAs($this->administrator, 'sanctum')
            ->putJson($this->url("members/{$this->administrator->id}"), ['role_ids' => [$this->role('member')->id]])
            ->assertOk();
    }

    public function test_members_of_other_organizations_are_not_found(): void
    {
        $northstarOnly = User::query()->where('email', 'northstar.member@example.test')->firstOrFail();
        $northstar = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();

        $this->actingAs($this->administrator, 'sanctum')
            ->putJson($this->url("members/{$northstarOnly->id}"), ['role_ids' => [$this->role('member')->id]])
            ->assertNotFound();

        // The shared operator is only a moderator in Northstar.
        $this->actingAs($this->administrator, 'sanctum')
            ->deleteJson("/api/v1/organizations/{$northstar->uuid}/members/{$northstarOnly->id}")
            ->assertForbidden();
    }

    public function test_invitation_sending_is_rate_limited(): void
    {
        $memberRole = $this->role('member')->id;

        foreach (range(1, 20) as $attempt) {
            $this->actingAs($this->administrator, 'sanctum')
                ->postJson($this->url('invitations'), ['email' => "person{$attempt}@example.test", 'role_ids' => [$memberRole]])
                ->assertCreated();
        }

        $this->actingAs($this->administrator, 'sanctum')
            ->postJson($this->url('invitations'), ['email' => 'one-too-many@example.test', 'role_ids' => [$memberRole]])
            ->assertTooManyRequests();
    }

    private function url(string $suffix): string
    {
        return "/api/v1/organizations/{$this->organization->uuid}/{$suffix}";
    }

    private function role(string $name): Role
    {
        return Role::query()->where('organization_id', $this->organization->id)->where('name', $name)->firstOrFail();
    }

    /**
     * @param  list<Role>  $roles
     */
    private function assignRoles(User $user, array $roles): void
    {
        $registrar = app(PermissionRegistrar::class);
        $previous = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($this->organization->id);
        $user->fresh()->syncRoles($roles);
        $registrar->setPermissionsTeamId($previous);
        $registrar->forgetCachedPermissions();
    }
}
