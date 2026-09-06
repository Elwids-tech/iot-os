<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('binding_parameter_mappings', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('transport_binding_id')->constrained()->cascadeOnDelete();
            $table->foreignId('profile_parameter_id')->constrained()->restrictOnDelete();
            $table->string('direction');
            $table->jsonb('transport_locator');
            $table->jsonb('codec_config')->nullable();
            $table->jsonb('transform_config')->nullable();
            $table->timestampsTz();

            $table->unique(['transport_binding_id', 'profile_parameter_id', 'direction'], 'binding_parameter_direction_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('binding_parameter_mappings');
    }
};
