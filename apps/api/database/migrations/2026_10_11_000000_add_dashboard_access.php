<?php

declare(strict_types=1);

use App\Domain\Dashboards\Services\DashboardPermissionBackfill;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Spatie\Permission\PermissionRegistrar;

/**
 * Dashboards get permissions of their own and per-dashboard sharing. Existing
 * dashboards stay open to the organization, and Device grants carry over, so
 * nobody loses access on upgrade.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dashboards', function (Blueprint $table): void {
            // organization: everyone with Dashboard.view; restricted: owner, managers and shares only.
            $table->string('access', 16)->default('organization');
        });
        Schema::create('dashboard_shares', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('dashboard_id')->constrained()->cascadeOnDelete();
            $table->foreignId('role_id')->nullable()->constrained(config('permission.table_names.roles'))->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('level', 8);
            $table->timestamps();
            $table->unique(['dashboard_id', 'role_id']);
            $table->unique(['dashboard_id', 'user_id']);
        });
        // Validation enforces these everywhere; Postgres also guards the data (SQLite cannot add checks later).
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE dashboard_shares ADD CONSTRAINT dashboard_shares_one_target CHECK ((role_id IS NULL) <> (user_id IS NULL))');
            DB::statement("ALTER TABLE dashboard_shares ADD CONSTRAINT dashboard_shares_level CHECK (level IN ('view', 'edit'))");
            DB::statement("ALTER TABLE dashboards ADD CONSTRAINT dashboards_access CHECK (access IN ('organization', 'restricted'))");
        }

        app(DashboardPermissionBackfill::class)->run();
    }

    public function down(): void
    {
        Schema::dropIfExists('dashboard_shares');
        Schema::table('dashboards', fn (Blueprint $table) => $table->dropColumn('access'));
        DB::table('permissions')->whereIn('name', ['Dashboard.view', 'Dashboard.create', 'Dashboard.manage'])->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
