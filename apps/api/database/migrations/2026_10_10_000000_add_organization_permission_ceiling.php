<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Platform administrators can narrow the tenant permissions an organization may grant.
 * Unrestricted organizations keep the full catalogue, including permissions added later.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table): void {
            $table->boolean('permissions_restricted')->default(false);
        });

        Schema::create('organization_permission', function (Blueprint $table): void {
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('permission_id')->constrained(config('permission.table_names.permissions'))->cascadeOnDelete();
            $table->primary(['organization_id', 'permission_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_permission');

        Schema::table('organizations', function (Blueprint $table): void {
            $table->dropColumn('permissions_restricted');
        });
    }
};
