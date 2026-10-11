<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('integration_applications', fn (Blueprint $table) => $table->unsignedInteger('grant_revision')->default(1));
        Schema::create('integration_streams', function (Blueprint $table): void {
            $table->foreignId('organization_id')->primary()->constrained()->restrictOnDelete();
            $table->unsignedBigInteger('sequence')->default(0);
        });
        Schema::create('integration_events', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->unsignedBigInteger('sequence');
            $table->uuid('device_uuid');
            $table->uuid('resource_uuid');
            $table->string('type');
            $table->json('snapshot');
            $table->timestampTz('occurred_at');
            $table->timestampTz('recorded_at');
            $table->unique(['organization_id', 'sequence']);
            $table->unique(['resource_uuid', 'type']);
            $table->index(['organization_id', 'device_uuid', 'sequence']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('integration_events');
        Schema::dropIfExists('integration_streams');
        Schema::table('integration_applications', fn (Blueprint $table) => $table->dropColumn('grant_revision'));
    }
};
