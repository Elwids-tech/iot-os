<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec 030: one row per application telemetry stream, so limits survive a crashed
// worker and operators can see who is streaming (research R5). A stream is open while
// closed_at is null and last_seen_at is fresher than 90 s; the relay refreshes it
// every 30 s. Named "sessions" because integration_streams is the event journal's
// sequence row.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('integration_stream_sessions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('integration_application_id')->constrained('integration_applications')->restrictOnDelete();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->timestampTz('opened_at');
            $table->timestampTz('last_seen_at');
            $table->string('last_position', 20)->nullable();
            $table->unsignedInteger('device_count');
            $table->timestampTz('closed_at')->nullable();
            // lifetime, grant_changed, credentials_changed, runtime_unavailable, shutdown, client, reset
            $table->string('close_reason', 32)->nullable();
            $table->index(['organization_id', 'closed_at', 'last_seen_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('integration_stream_sessions');
    }
};
