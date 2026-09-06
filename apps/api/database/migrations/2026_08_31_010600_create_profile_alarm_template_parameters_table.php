<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_alarm_template_parameters', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('profile_alarm_template_id')->constrained()->cascadeOnDelete();
            $table->foreignId('profile_parameter_id')->constrained()->restrictOnDelete();
            $table->string('role');
            $table->timestampsTz();

            $table->unique(['profile_alarm_template_id', 'profile_parameter_id'], 'profile_alarm_template_parameter_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_alarm_template_parameters');
    }
};
