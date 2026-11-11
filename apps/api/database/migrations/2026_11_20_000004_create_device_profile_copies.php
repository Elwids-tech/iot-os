<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A published profile version copied into another organization (spec 031, research R5).
 * Parameter UUIDs are unique across every profile, so each copy keeps the map from the
 * source's parameters to the target's.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_profile_copies', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('source_profile_id')->constrained('device_profiles');
            $table->foreignId('source_artifact_id')->constrained('device_profile_artifacts');
            $table->foreignId('target_organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('target_profile_id')->constrained('device_profiles');
            $table->foreignId('target_artifact_id')->constrained('device_profile_artifacts');
            $table->jsonb('parameter_map');
            $table->timestampsTz();
            $table->unique(['source_artifact_id', 'target_organization_id']);
            $table->index(['source_profile_id', 'target_organization_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_profile_copies');
    }
};
