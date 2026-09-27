<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operation_http_buckets', function (Blueprint $table): void {
            $table->unsignedBigInteger('minute');
            $table->unsignedInteger('status_class');
            $table->unsignedBigInteger('requests')->default(0);
            $table->double('duration_seconds')->default(0);
            $table->primary(['minute', 'status_class']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('operation_http_buckets');
    }
};
