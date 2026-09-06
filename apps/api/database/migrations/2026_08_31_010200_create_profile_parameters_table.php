<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_parameters', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_profile_id')->constrained()->cascadeOnDelete();
            $table->foreignId('parameter_group_id')->nullable()->constrained('profile_parameter_groups')->nullOnDelete();
            $table->string('key');
            $table->string('label');
            $table->text('description')->nullable();
            $table->string('kind');
            $table->string('data_type');
            $table->string('format')->nullable();
            $table->string('unit')->nullable();
            $table->boolean('reports_state')->default(true);
            $table->boolean('accepts_command')->default(false);
            $table->jsonb('validation_logic')->nullable();
            $table->jsonb('display_config')->nullable();
            $table->jsonb('reporting_config')->nullable();
            $table->jsonb('counter_config')->nullable();
            $table->integer('sort_order')->default(0);
            $table->timestampsTz();

            $table->unique(['device_profile_id', 'key']);
            $table->index(['device_profile_id', 'sort_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_parameters');
    }
};
