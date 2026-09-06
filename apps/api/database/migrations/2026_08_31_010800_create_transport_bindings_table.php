<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transport_bindings', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_profile_id')->constrained()->restrictOnDelete();
            $table->string('adapter_key');
            $table->string('name');
            $table->string('status')->default('draft');
            $table->jsonb('adapter_config')->nullable();
            $table->string('compile_status')->default('pending');
            $table->timestampsTz();

            $table->unique(['device_profile_id', 'name']);
            $table->index(['device_profile_id', 'adapter_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transport_bindings');
    }
};
