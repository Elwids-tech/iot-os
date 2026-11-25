<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Authorization\Models\Role;
use App\Domain\Entities\Services\EntityPermissionBackfill;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/** Spec 009 FR-018, research R14: nobody gains or loses anything when the entity permissions arrive. */
final class PermissionBackfillTest extends EntityTestCase
{
    public function test_device_grants_carry_over_to_entity_permissions(): void
    {
        // Start as before the migration: no entity permissions anywhere.
        DB::table('permissions')->whereIn('name', ['Entity.view', 'Entity.manage', 'EntityType.manage'])->delete();
        $registrar = app(PermissionRegistrar::class);
        $registrar->forgetCachedPermissions();
        $registrar->setPermissionsTeamId($this->organization->id);
        $lead = Role::create(['name' => 'line-lead', 'display_name' => 'Line lead', 'guard_name' => 'web', 'organization_id' => $this->organization->id, 'is_default' => false]);
        $lead->givePermissionTo('Device.manage');
        $viewer = Role::create(['name' => 'viewer', 'display_name' => 'Viewer', 'guard_name' => 'web', 'organization_id' => $this->organization->id, 'is_default' => false]);
        $viewer->givePermissionTo('Device.view');
        $direct = User::factory()->create();
        $this->organization->users()->attach($direct);
        $direct->givePermissionTo('Device.view');
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $northstar->forceFill(['permissions_restricted' => true])->save();
        $northstar->permissions()->sync(Permission::whereIn('name', ['Device.view', 'Organization.view'])->where('guard_name', 'web')->pluck('id'));
        $registrar->setPermissionsTeamId(null);
        $registrar->forgetCachedPermissions();

        app(EntityPermissionBackfill::class)->run();
        app(EntityPermissionBackfill::class)->run();

        $registrar->setPermissionsTeamId($this->organization->id);
        $this->assertTrue($lead->fresh()->hasPermissionTo('Entity.manage'));
        $this->assertTrue($lead->fresh()->hasPermissionTo('EntityType.manage'));
        $this->assertFalse($lead->fresh()->hasPermissionTo('Entity.view'), 'Device.manage alone did not let this role view devices either');
        $this->assertTrue($viewer->fresh()->hasPermissionTo('Entity.view'));
        $this->assertFalse($viewer->fresh()->hasPermissionTo('Entity.manage'));
        $this->assertTrue(DB::table('model_has_permissions')->where('model_id', $direct->id)
            ->where('permission_id', Permission::where('name', 'Entity.view')->where('guard_name', 'web')->value('id'))->exists(), 'direct grant');
        $admin = Role::where('organization_id', $this->organization->id)->where('name', 'organization-admin')->sole();
        $this->assertTrue($admin->hasPermissionTo('EntityType.manage'), 'Organization Admin equals the unrestricted ceiling');
        $this->assertSame(['Device.view', 'Entity.view', 'Organization.view'], $northstar->permissions()->pluck('name')->sort()->values()->all());
        $registrar->setPermissionsTeamId($northstar->id);
        $this->assertFalse(Role::where('organization_id', $northstar->id)->where('name', 'organization-admin')->sole()->hasPermissionTo('Entity.manage'), 'a restricted ceiling without Device.manage');
    }
}
