<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A super-administrator invitation belongs to no organization and holds no roles (spec 007).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organization_invitations', function (Blueprint $table): void {
            $table->foreignId('organization_id')->nullable()->change();
            $table->boolean('grants_super_admin')->default(false)->after('organization_id');
        });

        // An organization invitation can never lose its organization and grant super administrator access.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE organization_invitations ADD CONSTRAINT organization_invitations_kind_check CHECK ((organization_id IS NULL) = grants_super_admin)');
        }
    }

    public function down(): void
    {
        DB::table('organization_invitations')->whereNull('organization_id')->delete();

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE organization_invitations DROP CONSTRAINT organization_invitations_kind_check');
        }

        Schema::table('organization_invitations', function (Blueprint $table): void {
            $table->dropColumn('grants_super_admin');
            $table->foreignId('organization_id')->nullable(false)->change();
        });
    }
};
