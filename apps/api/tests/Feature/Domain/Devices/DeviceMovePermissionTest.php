<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Administration\Services\OrganizationDefaultRoles;
use App\Domain\Administration\Services\OrganizationPermissionCeiling;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceMovePermissionBackfill;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

/**
 * `Device.move` (spec 031 FR-062, research R9): the backfill gives it to Organization
 * Admin of every organization whose permission ceiling is unrestricted, and to nobody
 * else. A, B on one billing account; C, restricted, on another.
 */
final class DeviceMovePermissionTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_backfill_gives_organization_admin_device_move_and_changes_nothing_else(): void
    {
        $this->seed(DatabaseSeeder::class);
        $a = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $b = Organization::factory()->forBillingAccount($a->billingAccount)->create(['name' => 'Harbour Shop']);
        $c = Organization::factory()->create(['name' => 'Elsewhere Works']);
        foreach ([$b, $c] as $organization) {
            app(OrganizationDefaultRoles::class)->ensure($organization);
        }
        $ceiling = app(OrganizationPermissionCeiling::class);
        $ceiling->update($c, true, array_values(array_diff($ceiling->namesFor($c), [DevicePermission::MOVE->value])));
        // Before the migration the permission did not exist.
        Permission::where('name', DevicePermission::MOVE->value)->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $before = $this->grants();
        $restricted = $c->permissions()->pluck('name')->sort()->values()->all();

        app(DeviceMovePermissionBackfill::class)->run();

        $this->assertEqualsCanonicalizing(array_values(array_diff(array_keys(config('auth.guards')), ['mcp'])), Permission::where('name', DevicePermission::MOVE->value)->pluck('guard_name')->all());
        $after = $this->grants();
        foreach ([$a, $b] as $organization) {
            $this->assertContains(DevicePermission::MOVE->value, $after[$organization->id][OrganizationRoleName::ORGANIZATION_ADMIN->value]);
            $this->assertNotContains(DevicePermission::MOVE->value, $after[$organization->id][OrganizationRoleName::MODERATOR->value]);
            $this->assertNotContains(DevicePermission::MOVE->value, $after[$organization->id][OrganizationRoleName::MEMBER->value]);
        }
        $this->assertNotContains(DevicePermission::MOVE->value, $after[$c->id][OrganizationRoleName::ORGANIZATION_ADMIN->value]);
        $this->assertSame($restricted, $c->permissions()->pluck('name')->sort()->values()->all());
        // Nothing else changed for any role.
        foreach ($after as $organization => $roles) {
            foreach ($roles as $role => $permissions) {
                $this->assertSame($before[$organization][$role], array_values(array_diff($permissions, [DevicePermission::MOVE->value])), $organization.' '.$role);
            }
        }

        // It shows as `capabilities.devices.move`.
        $admin = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->actingAs($admin, 'sanctum');
        $organizations = collect($this->getJson('/api/v1/me')->assertOk()->json('data.organizations'))->keyBy('uuid');
        $this->assertTrue($organizations[$a->uuid]['capabilities']['devices']['move']);
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->actingAs($member, 'sanctum');
        $this->assertFalse(collect($this->getJson('/api/v1/me')->assertOk()->json('data.organizations'))->firstWhere('uuid', $a->uuid)['capabilities']['devices']['move']);
    }

    /** @return array<int, array<string, list<string>>> each organization's roles and their permission names */
    private function grants(): array
    {
        $grants = [];
        foreach (Role::whereNotNull('organization_id')->get() as $role) {
            $grants[$role->organization_id][$role->name] = DB::table('role_has_permissions')->join('permissions', 'permissions.id', '=', 'role_has_permissions.permission_id')
                ->where('role_id', $role->id)->orderBy('permissions.name')->pluck('permissions.name')->all();
        }

        return $grants;
    }
}
