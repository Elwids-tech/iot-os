<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // Publishing a profile wrote a row here and nothing ever read one.
    public function up(): void
    {
        Schema::dropIfExists('device_profile_activation_outbox');
    }

    // Restores the empty table; the rows it held were never used and are not brought back.
    public function down(): void
    {
        Schema::create('device_profile_activation_outbox', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_profile_artifact_id')->constrained()->restrictOnDelete();
            $table->string('event_type');
            $table->jsonb('payload');
            $table->timestampTz('published_at')->nullable();
            $table->timestampsTz();

            $table->unique(['device_profile_artifact_id', 'event_type']);
        });
    }
};
