<?php

declare(strict_types=1);

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * `PlatformAdministration.reset-two-step` (spec 034, FR-024): every platform role that
 * already manages organizations and users may reset a locked-out person's two-step
 * sign-in. Other platform roles are unchanged; super administrators hold it implicitly.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();
        DB::table('permissions')->insertOrIgnore([
            'name' => PlatformAdministrationPermission::RESET_TWO_STEP->value,
            'guard_name' => 'web',
            'group' => PlatformAdministrationPermission::getPermissionGroup(),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $reset = DB::table('permissions')->where('name', PlatformAdministrationPermission::RESET_TWO_STEP->value)->where('guard_name', 'web')->value('id');
        $manage = DB::table('permissions')->where('name', PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)->where('guard_name', 'web')->value('id');

        if ($reset !== null && $manage !== null) {
            $roles = DB::table('platform_role_permission')->where('permission_id', $manage)->pluck('platform_role_id');
            DB::table('platform_role_permission')->insertOrIgnore(
                $roles->map(fn ($role): array => ['platform_role_id' => $role, 'permission_id' => $reset])->all(),
            );
        }

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    public function down(): void
    {
        DB::table('permissions')->where('name', PlatformAdministrationPermission::RESET_TWO_STEP->value)->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
