<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\OrganizationPermission;
use App\Domain\Shared\Permissions\UserPermission;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class PlatformRolePermissionApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_can_view_an_organization_role_permission_catalog(): void
    {
        $this->seed(DatabaseSeeder::class);

        $response = $this->actingAs($this->superAdmin())
            ->getJson('/api/v1/admin/roles/'.$this->moderator()->getKey());

        $response
            ->assertOk()
            ->assertJsonPath('data.display_name', 'Moderator')
            ->assertJsonPath('data.permissions_editable', true)
            ->assertJsonFragment([
                'name' => OrganizationPermission::VIEW->value,
                'group' => 'Organization',
            ])
            ->assertJsonMissing([
                'name' => PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value,
            ]);
    }

    public function test_platform_administrator_can_replace_an_organization_role_permission_bundle(): void
    {
        $this->seed(DatabaseSeeder::class);

        $role = $this->moderator();
        $permissionNames = [
            OrganizationPermission::VIEW->value,
            UserPermission::VIEW->value,
        ];

        $response = $this->actingAs($this->platformAdministrator())
            ->putJson('/api/v1/admin/roles/'.$role->getKey().'/permissions', [
                'permission_names' => $permissionNames,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('data.permissions_editable', true)
            ->assertJsonFragment([
                'name' => OrganizationPermission::VIEW->value,
                'group' => 'Organization',
                'assigned' => true,
            ])
            ->assertJsonFragment([
                'name' => UserPermission::VIEW->value,
                'group' => 'User',
                'assigned' => true,
            ]);

        $this->assertSame(
            collect($permissionNames)->sort()->values()->all(),
            $role->fresh('permissions')->permissions->pluck('name')->sort()->values()->all(),
        );
    }

    public function test_organization_user_cannot_view_or_update_platform_role_permissions(): void
    {
        $this->seed(DatabaseSeeder::class);

        $role = $this->moderator();
        $user = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();

        $this->actingAs($user)
            ->getJson('/api/v1/admin/roles/'.$role->getKey())
            ->assertForbidden();

        $this->actingAs($user)
            ->putJson('/api/v1/admin/roles/'.$role->getKey().'/permissions', [
                'permission_names' => [],
            ])
            ->assertForbidden();
    }

    public function test_platform_permissions_and_unknown_permissions_are_rejected(): void
    {
        $this->seed(DatabaseSeeder::class);

        $role = $this->moderator();

        $this->actingAs($this->superAdmin())
            ->putJson('/api/v1/admin/roles/'.$role->getKey().'/permissions', [
                'permission_names' => [PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['permission_names']);

        $this->actingAs($this->superAdmin())
            ->putJson('/api/v1/admin/roles/'.$role->getKey().'/permissions', [
                'permission_names' => ['Unknown.permission'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['permission_names']);
    }

    public function test_organization_admin_permission_baseline_cannot_be_changed(): void
    {
        $this->seed(DatabaseSeeder::class);

        $role = Role::query()
            ->where('organization_id', $this->acme()->getKey())
            ->where('name', OrganizationRoleName::ORGANIZATION_ADMIN->value)
            ->firstOrFail();

        $this->actingAs($this->superAdmin())
            ->putJson('/api/v1/admin/roles/'.$role->getKey().'/permissions', [
                'permission_names' => [],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['permission_names']);
    }

    public function test_non_organization_roles_are_not_exposed_by_the_platform_role_permission_endpoint(): void
    {
        $this->seed(DatabaseSeeder::class);

        $role = Role::query()->create([
            'name' => 'platform-only-test-role',
            'display_name' => 'Platform-only test role',
            'guard_name' => 'web',
            'is_default' => false,
        ]);

        $this->actingAs($this->superAdmin())
            ->getJson('/api/v1/admin/roles/'.$role->getKey())
            ->assertNotFound();
    }

    private function moderator(): Role
    {
        return Role::query()
            ->where('organization_id', $this->acme()->getKey())
            ->where('name', OrganizationRoleName::MODERATOR->value)
            ->firstOrFail();
    }

    private function acme(): Organization
    {
        return Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
    }

    private function superAdmin(): User
    {
        return User::query()->where('email', 'super-admin@example.test')->firstOrFail();
    }

    private function platformAdministrator(): User
    {
        return User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
    }
}
