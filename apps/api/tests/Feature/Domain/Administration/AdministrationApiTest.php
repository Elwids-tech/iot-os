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
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

final class AdministrationApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_platform_administrators_can_manage_the_organization_directory_without_tenant_context(): void
    {
        $this->seed(DatabaseSeeder::class);

        $platformAdministrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();

        $this->assertFalse($platformAdministrator->is_super_admin);
        $this->assertFalse($platformAdministrator->organizations()->exists());

        $this->actingAs($platformAdministrator, 'sanctum')
            ->getJson('/api/v1/admin/organizations')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.users_count', 3);

        $this->actingAs($platformAdministrator, 'sanctum')
            ->getJson("/api/v1/organizations/{$organization->uuid}/context")
            ->assertForbidden();

        $this->actingAs(User::query()->where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum')
            ->getJson('/api/v1/admin/organizations')
            ->assertForbidden();
    }

    public function test_platform_administrators_can_create_organizations_and_super_admins_manage_platform_access(): void
    {
        $this->seed(DatabaseSeeder::class);

        $platformAdministrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $superAdmin = User::query()->where('email', 'super-admin@example.test')->firstOrFail();
        $member = User::query()->where('email', 'acme.member@example.test')->firstOrFail();

        $this->actingAs($platformAdministrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', [
                'name' => 'Cedar Processing',
                'slug' => 'cedar-processing',
            ])
            ->assertCreated()
            ->assertJsonPath('data.slug', 'cedar-processing');

        $this->actingAs($platformAdministrator, 'sanctum')
            ->getJson('/api/v1/admin/platform-team')
            ->assertForbidden();

        $this->actingAs($superAdmin, 'sanctum')
            ->putJson("/api/v1/admin/platform-team/{$member->id}", [
                'is_platform_administrator' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.platform_roles.0.key', 'platform-administrator');
    }

    public function test_organization_administrators_manage_custom_roles_but_cannot_assign_platform_permissions(): void
    {
        $this->seed(DatabaseSeeder::class);

        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();

        $registrar = app(PermissionRegistrar::class);
        $registrar->setPermissionsTeamId($organization->id);
        $this->assertTrue($administrator->fresh()->hasPermissionTo('Role.create'));
        $registrar->setPermissionsTeamId(null);

        $response = $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$organization->uuid}/roles", [
                'display_name' => 'Maintenance Operator',
                'permission_names' => ['Organization.view', 'User.view-any'],
            ]);

        $response->assertCreated()
            ->assertJsonPath('data.display_name', 'Maintenance Operator')
            ->assertJsonPath('data.is_default', false);

        $organizationAdminRole = Role::query()
            ->where('organization_id', $organization->id)
            ->where('name', 'organization-admin')
            ->firstOrFail();

        $this->actingAs($administrator, 'sanctum')
            ->patchJson("/api/v1/organizations/{$organization->uuid}/roles/{$organizationAdminRole->id}", [
                'display_name' => 'Organization Admin',
                'permission_names' => [],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('permission_names');

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$organization->uuid}/roles", [
                'display_name' => 'Escalation Attempt',
                'permission_names' => ['PlatformAdministration.access'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('permission_names');

        $this->actingAs(User::query()->where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum')
            ->getJson("/api/v1/organizations/{$organization->uuid}/roles")
            ->assertForbidden();
    }

    public function test_organization_invitations_are_hashed_and_acceptance_creates_an_organization_member(): void
    {
        Notification::fake();
        $this->seed(DatabaseSeeder::class);

        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $memberRole = Role::query()
            ->where('organization_id', $organization->id)
            ->where('name', 'member')
            ->firstOrFail();

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$organization->uuid}/invitations", [
                'email' => 'invited.member@example.test',
                'role_ids' => [$memberRole->id],
            ])
            ->assertCreated()
            ->assertJsonPath('data.email', 'invited.member@example.test');

        $invitation = OrganizationInvitation::query()->where('email', 'invited.member@example.test')->firstOrFail();
        $this->assertSame(64, strlen($invitation->token_hash));
        Notification::assertSentOnDemand(OrganizationInvitationNotification::class);

        $token = Str::random(64);
        $acceptanceInvitation = OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $organization->id,
            'email' => 'new.member@example.test',
            'role_ids' => [$memberRole->id],
            'token_hash' => hash('sha256', $token),
            'invited_by_user_id' => $administrator->id,
            'expires_at' => now()->addDays(7),
        ]);

        $this->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'New Member',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
        ])
            ->assertOk()
            ->assertJsonPath('data.email', 'new.member@example.test');

        $newMember = User::query()->where('email', 'new.member@example.test')->firstOrFail();
        $this->assertTrue($newMember->organizations()->whereKey($organization->id)->exists());
        $this->assertNotNull($acceptanceInvitation->fresh()->accepted_at);

        $registrar = app(PermissionRegistrar::class);
        $previousTeamId = $registrar->getPermissionsTeamId();
        $registrar->setPermissionsTeamId($organization->id);
        $this->assertTrue($newMember->fresh()->hasRole('member'));
        $registrar->setPermissionsTeamId($previousTeamId);
    }

    public function test_an_organization_must_keep_an_organization_administrator(): void
    {
        $this->seed(DatabaseSeeder::class);

        $organization = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();

        $this->actingAs($administrator, 'sanctum')
            ->deleteJson("/api/v1/organizations/{$organization->uuid}/members/{$administrator->id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('member');
    }
}
