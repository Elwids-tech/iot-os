<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bulk onboarding runs (spec 026 US5): one operator action over selected discovered
 * sources of one gateway, with one item per source. An item is never stored as active;
 * that is read from its device's applied configuration.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_bulk_onboardings', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sparkplug_gateway_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_profile_artifact_id')->constrained()->restrictOnDelete();
            $table->string('name_pattern', 120);
            $table->char('request_hash', 64);
            $table->string('status')->default('queued');
            // An integer user id (ADR-013).
            $table->unsignedBigInteger('created_by');
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampsTz();
            $table->index(['organization_id', 'created_at']);
        });

        Schema::create('device_bulk_onboarding_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('device_bulk_onboarding_id')->constrained()->cascadeOnDelete();
            $table->string('source_device_id', 128);
            $table->foreignId('discovery_candidate_id')->nullable()->constrained('device_discovery_candidates')->nullOnDelete();
            $table->foreignId('device_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status')->default('pending');
            $table->string('reason', 500)->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestampsTz();
            $table->unique(['device_bulk_onboarding_id', 'source_device_id'], 'bulk_onboarding_item_source_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_bulk_onboarding_items');
        Schema::dropIfExists('device_bulk_onboardings');
    }
};
