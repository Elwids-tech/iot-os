<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One summary push per person, organization and burst window (spec 033, FR-024).
 * Deliveries it carries point at it, so an alert is counted in at most one summary and
 * two windows never overlap.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('push_summaries', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('window_started_at')->comment('When the first delivery joined it');
            $table->timestampTz('window_ends_at')->comment('window_started_at + 60 s; open while in the future');
            $table->integer('alert_count')->default(0);
            $table->string('status', 16)->default('pending')->comment('pending, sent, failed or cancelled');
            $table->smallInteger('attempts')->default(0);
            $table->smallInteger('cycle_attempts')->default(0);
            $table->smallInteger('devices_total')->nullable();
            $table->smallInteger('devices_reached')->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->string('diagnostic', 255)->nullable();
            $table->timestampsTz();
            $table->unique(['user_id', 'organization_id', 'window_started_at']);
        });
        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->foreignId('push_summary_id')->nullable()->index()->constrained('push_summaries')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('push_summary_id');
        });
        Schema::dropIfExists('push_summaries');
    }
};
