<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A gateway's saved firmware choices (spec 027 FR-042): the target, the node profile and the
 * device profiles of its last firmware download, so teammates see the same choices.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sparkplug_gateways', function (Blueprint $table): void {
            $table->jsonb('firmware_selection')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('sparkplug_gateways', function (Blueprint $table): void {
            $table->dropColumn('firmware_selection');
        });
    }
};
