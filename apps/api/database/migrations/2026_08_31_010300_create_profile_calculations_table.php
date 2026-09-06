<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_calculations', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_profile_id')->constrained()->cascadeOnDelete();
            $table->foreignId('target_profile_parameter_id')->unique()->constrained('profile_parameters')->cascadeOnDelete();
            $table->string('engine')->default('json_logic');
            $table->jsonb('expression');
            $table->string('trigger')->default('on_input_change');
            $table->string('failure_policy')->default('mark_invalid');
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_calculations');
    }
};
