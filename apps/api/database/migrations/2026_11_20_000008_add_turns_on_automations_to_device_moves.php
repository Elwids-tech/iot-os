<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A move that brings an automation into an organization with automations turned off may
 * turn them on there at cutover, when the mover chose to and may (spec 031 FR-039).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_moves', function (Blueprint $table): void {
            $table->boolean('turns_on_automations')->default(false)->after('include_history');
        });
    }

    public function down(): void
    {
        Schema::table('device_moves', fn (Blueprint $table) => $table->dropColumn('turns_on_automations'));
    }
};
