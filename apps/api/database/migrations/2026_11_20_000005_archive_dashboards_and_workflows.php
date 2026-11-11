<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dashboards and automations can be archived and restored (spec 031 FR-037, research
 * R12). An archived item stays readable but is hidden from lists by default. The move
 * that archived it (`archived_by_move_id`) arrives with device moves in PR 031-4.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['dashboards', 'automation_workflows'] as $name) {
            Schema::table($name, function (Blueprint $table): void {
                $table->timestampTz('archived_at')->nullable();
                $table->foreignId('archived_by')->nullable()->constrained('users')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (['dashboards', 'automation_workflows'] as $name) {
            Schema::table($name, function (Blueprint $table): void {
                $table->dropConstrainedForeignId('archived_by');
                $table->dropColumn('archived_at');
            });
        }
    }
};
