<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_alarm_templates', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_profile_id')->constrained()->cascadeOnDelete();
            $table->string('code');
            $table->string('name');
            $table->string('type');
            $table->string('severity');
            $table->jsonb('condition_config');
            $table->boolean('enabled_by_default')->default(true);
            $table->timestampsTz();

            $table->unique(['device_profile_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_alarm_templates');
    }
};
