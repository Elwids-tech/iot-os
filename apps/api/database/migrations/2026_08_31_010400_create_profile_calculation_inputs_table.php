<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_calculation_inputs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('profile_calculation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('profile_parameter_id')->constrained()->restrictOnDelete();
            $table->string('alias');
            $table->timestampsTz();

            $table->unique(['profile_calculation_id', 'profile_parameter_id'], 'profile_calculation_inputs_parameter_unique');
            $table->unique(['profile_calculation_id', 'alias'], 'profile_calculation_inputs_alias_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_calculation_inputs');
    }
};
