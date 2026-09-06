<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profile_parameter_groups', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_profile_id')->constrained()->cascadeOnDelete();
            $table->string('code');
            $table->string('label');
            $table->text('description')->nullable();
            $table->integer('sort_order')->default(0);
            $table->timestampsTz();

            $table->unique(['device_profile_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_parameter_groups');
    }
};
