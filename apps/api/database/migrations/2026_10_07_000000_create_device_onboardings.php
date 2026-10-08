<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_onboardings', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('device_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('sparkplug_gateway_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_profile_artifact_id')->constrained()->restrictOnDelete();
            $table->string('mode', 16);
            $table->string('source_device_id', 128)->default('');
            $table->string('request_hash', 64);
            $table->timestamp('provisioned_at')->nullable();
            $table->text('diagnostic')->nullable();
            $table->timestamps();
            $table->unique(['sparkplug_gateway_id', 'source_device_id'], 'onboarding_source_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_onboardings');
    }
};
