<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operation_heartbeats', function (Blueprint $table): void {
            $table->string('name')->primary();
            $table->unsignedBigInteger('seen_at');
        });

    }

    public function down(): void
    {
        Schema::dropIfExists('operation_heartbeats');
    }
};
