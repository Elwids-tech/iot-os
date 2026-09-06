<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_profile_artifacts', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_profile_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('revision');
            $table->char('definition_hash', 64);
            $table->jsonb('definition');
            $table->string('status')->default('active');
            $table->timestampTz('compiled_at');
            $table->foreignId('compiled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['device_profile_id', 'revision']);
            $table->unique(['device_profile_id', 'definition_hash']);
            $table->index(['device_profile_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_profile_artifacts');
    }
};
