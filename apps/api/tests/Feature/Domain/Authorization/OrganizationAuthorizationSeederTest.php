<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authorization;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

class OrganizationAuthorizationSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_demo_seed_has_three_memberships_per_organization_and_one_shared_user(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseCount('organizations', 2);
        $this->assertDatabaseCount('users', 7);
        $this->assertDatabaseCount('roles', 6);
        $this->assertDatabaseHas('users', [
            'email' => 'super-admin@example.test',
            'is_super_admin' => true,
        ]);

        foreach (Organization::query()->get() as $organization) {
            $this->assertCount(3, $organization->users);
            $this->assertCount(3, $organization->roles);
        }

        $this->assertCount(
            2,
            User::query()->where('email', 'shared.operator@example.test')->firstOrFail()->organizations,
        );
    }

    public function test_permissions_are_global_but_roles_are_scoped_to_the_active_team(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseCount('permissions', 86);
        $this->assertDatabaseHas('permissions', [
            'name' => 'Organization.delete',
            'guard_name' => 'web',
            'group' => 'Organization',
        ]);

        $acme = Organization::query()->where('slug', 'acme-manufacturing')->firstOrFail();
        $northstar = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();
        $sharedUser = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();
        $permissionRegistrar = app(PermissionRegistrar::class);
        $previousTeamId = $permissionRegistrar->getPermissionsTeamId();

        try {
            $permissionRegistrar->setPermissionsTeamId($acme->id);
            $this->assertTrue($sharedUser->fresh()->hasRole('organization-admin'));
            $this->assertTrue($sharedUser->fresh()->hasPermissionTo('Organization.delete'));

            $permissionRegistrar->setPermissionsTeamId($northstar->id);
            $this->assertTrue($sharedUser->fresh()->hasRole('moderator'));
            $this->assertFalse($sharedUser->fresh()->hasPermissionTo('Organization.delete'));
        } finally {
            $permissionRegistrar->setPermissionsTeamId($previousTeamId);
        }
    }

    public function test_the_demo_seed_is_idempotent(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->seed(DatabaseSeeder::class);

        $this->assertDatabaseCount('organizations', 2);
        $this->assertDatabaseCount('users', 7);
        $this->assertDatabaseCount('organization_user', 6);
        $this->assertDatabaseCount('roles', 6);
        $this->assertSame(86, Permission::query()->count());
    }
}
