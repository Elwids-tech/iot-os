<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The generation a device's applied configuration came with (ADR-027). A refused
 * activation advances deployment_generation and leaves it, so automations and location
 * bindings that use the applied configuration stay valid. Existing devices get the
 * generation their bindings already had to use, as the runtime does: the current one,
 * or the one before a request it has not answered yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table): void {
            $table->unsignedInteger('applied_generation')->nullable();
        });
        DB::table('devices')->whereNotNull('applied_configuration_uuid')->update(['applied_generation' => DB::raw(
            "CASE WHEN deployment_status = 'pending' THEN deployment_generation - 1 ELSE deployment_generation END"
        )]);
    }

    public function down(): void
    {
        Schema::table('devices', function (Blueprint $table): void {
            $table->dropColumn('applied_generation');
        });
    }
};
