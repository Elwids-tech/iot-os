<?php

declare(strict_types=1);

use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceMovePermissionBackfill;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * `Device.move` (spec 031): Organization Admin of every unrestricted organization gets it;
 * restricted ceilings and every other role are unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        app(DeviceMovePermissionBackfill::class)->run();
    }

    public function down(): void
    {
        DB::table('permissions')->where('name', DevicePermission::MOVE->value)->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
