<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The assistant's provider, model, keys and spend limits as saved in admin (spec 010).
 * Null values and missing keys fall back to the server environment.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assistant_settings', function (Blueprint $table): void {
            $table->id();
            $table->string('scope_key')->unique();
            $table->string('provider')->nullable();
            $table->string('model')->nullable();
            $table->decimal('daily_budget_usd', 10, 6)->nullable();
            $table->decimal('run_budget_usd', 10, 6)->nullable();
            $table->unsignedInteger('revision')->default(0);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('assistant_provider_keys', function (Blueprint $table): void {
            $table->id();
            $table->string('provider')->unique();
            $table->text('api_key');
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('assistant_provider_keys');
        Schema::dropIfExists('assistant_settings');
    }
};
