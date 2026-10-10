<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

final class OrganizationPermissionCeilingTest extends TestCase
{
    use RefreshDatabase;

    private const CEILING = ['Device.view', 'Organization.view', 'Role.create', 'Role.view-any', 'User.create', 'User.view-any'];

    public function test_narrowing_the_ceiling_strips_role_permissions_and_admin_follows_it(): void
    {
        $this->seed(DatabaseSeeder::class);
        $platformAdministrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $northstar = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $catalogueCount = app(OrganizationPermissionCeiling::class)->catalogue()->count();

        $this->actingAs($platformAdministrator, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$acme->uuid}/permissions")
            ->assertOk()
            ->assertJsonPath('data.restricted', false)
            ->assertJsonCount($catalogueCount, 'data.permission_names')
            ->assertJsonCount($catalogueCount, 'data.catalogue');

        $this->actingAs($platformAdministrator, 'sanctum')
            ->putJson("/api/v1/admin/organizations/{$acme->uuid}/permissions", [
                'restricted' => true,
                'permission_names' => self::CEILING,
            ])
            ->assertOk()
            ->assertJsonPath('data.restricted', true)
            ->assertJsonPath('data.permission_names', self::CEILING);

        $this->assertSame(self::CEILING, $this->rolePermissions($acme, 'organization-admin'));
        $this->assertSame(['Device.view', 'Organization.view', 'User.view-any'], $this->rolePermissions($acme, 'moderator'));
        $this->assertSame(['Device.view', 'Organization.view'], $this->rolePermissions($acme, 'member'));
        $this->assertContains('DeviceProfile.publish', $this->rolePermissions($northstar, 'organization-admin'));

        $this->actingAs($platformAdministrator, 'sanctum')
            ->putJson("/api/v1/admin/organizations/{$acme->uuid}/permissions", ['restricted' => false])
            ->assertOk()
            ->assertJsonCount($catalogueCount, 'data.permission_names');

        $this->assertCount($catalogueCount, $this->rolePermissions($acme, 'organization-admin'));
        // Widening never re-grants what narrowing removed from other roles.
        $this->assertSame(['Device.view', 'Organization.view'], $this->rolePermissions($acme, 'member'));
    }

    public function test_roles_cannot_exceed_a_restricted_ceiling(): void
    {
        $this->seed(DatabaseSeeder::class);
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $platformAdministrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        app(OrganizationPermissionCeiling::class)->update($acme, true, self::CEILING);

        $this->actingAs($administrator, 'sanctum')
            ->getJson("/api/v1/organizations/{$acme->uuid}/role-permissions")
            ->assertOk()
            ->assertJsonCount(count(self::CEILING), 'data')
            ->assertJsonPath('data.0.grantable', true);

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$acme->uuid}/roles", [
                'display_name' => 'Operators',
                'permission_names' => ['Device.view', 'Device.manage'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('permission_names');

        $this->actingAs($administrator, 'sanctum')
            ->postJson("/api/v1/organizations/{$acme->uuid}/roles", [
                'display_name' => 'Viewers',
                'permission_names' => ['Device.view'],
            ])
            ->assertCreated();

        $moderator = Role::query()->where('organization_id', $acme->id)->where('name', 'moderator')->firstOrFail();
        $this->actingAs($platformAdministrator, 'sanctum')
            ->putJson("/api/v1/admin/roles/{$moderator->id}/permissions", ['permission_names' => ['Device.manage']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('permission_names');
    }

    public function test_only_platform_administrators_manage_the_ceiling(): void
    {
        $this->seed(DatabaseSeeder::class);
        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $administrator = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();

        $this->actingAs($administrator, 'sanctum')
            ->getJson("/api/v1/admin/organizations/{$acme->uuid}/permissions")
            ->assertForbidden();
        $this->actingAs($administrator, 'sanctum')
            ->putJson("/api/v1/admin/organizations/{$acme->uuid}/permissions", ['restricted' => false])
            ->assertForbidden();
    }

    public function test_platform_created_organizations_get_default_roles_and_can_invite(): void
    {
        Notification::fake();
        $this->seed(DatabaseSeeder::class);
        $platformAdministrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();

        $uuid = $this->actingAs($platformAdministrator, 'sanctum')
            ->postJson('/api/v1/admin/organizations', ['name' => 'Cedar Processing', 'slug' => 'cedar-processing'])
            ->assertCreated()
            ->json('data.uuid');
        $organization = Organization::query()->where('uuid', $uuid)->firstOrFail();

        $roles = Role::query()->where('organization_id', $organization->id)->pluck('name')->sort()->values()->all();
        $this->assertSame(['member', 'moderator', 'organization-admin'], $roles);

        $administratorRole = Role::query()->where('organization_id', $organization->id)->where('name', 'organization-admin')->firstOrFail();
        $this->actingAs($platformAdministrator, 'sanctum')
            ->postJson("/api/v1/admin/organizations/{$uuid}/invitations", [
                'email' => 'first.admin@example.test',
                'role_ids' => [$administratorRole->id],
            ])
            ->assertCreated();
    }

    public function test_session_payload_reports_administration_capabilities(): void
    {
        $this->seed(DatabaseSeeder::class);

        $capabilities = fn (string $email): array => collect(
            $this->actingAs(User::query()->where('email', $email)->firstOrFail(), 'sanctum')
                ->getJson('/api/v1/me')
                ->assertOk()
                ->json('data.organizations'),
        )->firstWhere('slug', 'acme-manufacturing')['capabilities']['administration'];

        $this->assertSame([
            'members_view' => true, 'invite' => true, 'members_update' => true, 'members_remove' => true,
            'roles_view' => true, 'roles_create' => true, 'roles_update' => true, 'roles_delete' => true,
        ], $capabilities('shared.operator@example.test'));

        $moderator = $capabilities('acme.moderator@example.test');
        $this->assertTrue($moderator['members_view']);
        $this->assertFalse($moderator['invite']);
        $this->assertFalse($moderator['roles_view']);

        $this->assertFalse($capabilities('acme.member@example.test')['members_view']);
    }

    /**
     * @return list<string>
     */
    private function rolePermissions(Organization $organization, string $role): array
    {
        return Role::query()
            ->where('organization_id', $organization->id)
            ->where('name', $role)
            ->firstOrFail()
            ->permissions()
            ->pluck('name')
            ->sort()
            ->values()
            ->all();
    }
}
