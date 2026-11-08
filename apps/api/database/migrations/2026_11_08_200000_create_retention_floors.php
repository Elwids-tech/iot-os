<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The 30-day grace before a billing change shortens an organization's telemetry
 * retention (spec 029 US4, FR-020, research R10). Until `until`, cleanup keeps at least
 * `days`, the period that applied before the change. Floors go with their organization
 * and are pruned once they end.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('telemetry_retention_floors', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->unsignedInteger('days');
            $table->timestampTz('until');
            // plan_changed, plan_edited, override, organization_moved, trial
            $table->string('reason', 64);
            // The owners were told 7 days before it ends.
            $table->timestampTz('warned_at')->nullable();
            $table->timestampTz('created_at');
            $table->index(['organization_id', 'until']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('telemetry_retention_floors');
    }
};
