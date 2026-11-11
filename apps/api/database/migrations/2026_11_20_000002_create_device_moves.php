<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Moves within a billing account (spec 031, data model): a move, its devices, and the
 * link each cutover leaves between a predecessor and its successor. Organization keys
 * cascade: an organization that took part in a move still has the predecessor or the
 * successor, and devices block its deletion (OrganizationDeletion).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_moves', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->uuid('operation_uuid')->unique();
            $table->char('request_hash', 64);
            $table->foreignId('source_organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('target_organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('billing_account_id')->constrained();
            $table->foreignId('mover_id')->constrained('users');
            $table->enum('origin', ['devices', 'device', 'assistant']);
            $table->boolean('include_history')->default(false);
            $table->enum('status', ['stopping', 'completed', 'failed']);
            $table->text('failure_reason')->nullable();
            $table->jsonb('review');
            $table->timestampTz('confirmed_at');
            $table->timestampTz('cutover_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampsTz();
            $table->index(['source_organization_id', 'status']);
            $table->index(['target_organization_id', 'status']);
        });

        Schema::create('device_move_devices', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('device_move_id')->constrained()->cascadeOnDelete();
            $table->foreignId('predecessor_device_id')->constrained('devices');
            $table->foreignId('successor_device_id')->nullable()->constrained('devices');
            $table->string('name');
            $table->string('code', 128);
            $table->foreignId('target_site_id')->nullable()->constrained('sites')->nullOnDelete();
            $table->boolean('was_active');
            $table->boolean('arrives_active');
            $table->uuid('stop_operation_uuid')->nullable()->index();
            $table->enum('state', ['waiting', 'stopping', 'stopped', 'moved', 'failed']);
            // The predecessor's id while its move is stopping: a device is in one move at a time.
            $table->unsignedBigInteger('outstanding_key')->nullable()->unique();
            $table->timestampsTz();
        });

        Schema::create('device_links', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('predecessor_device_id')->unique()->constrained('devices');
            $table->foreignId('successor_device_id')->unique()->constrained('devices');
            $table->foreignId('source_organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('target_organization_id')->constrained('organizations')->cascadeOnDelete();
            // Null leaves room for links made outside a move (spec 016).
            $table->foreignId('device_move_id')->nullable()->constrained()->nullOnDelete();
            $table->timestampTz('cutover_at');
            $table->boolean('history_included')->default(false);
            $table->timestampTz('history_stopped_at')->nullable();
            $table->foreignId('history_stopped_by')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('history_stopped_reason', ['stopped', 'left_account'])->nullable();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_links');
        Schema::dropIfExists('device_move_devices');
        Schema::dropIfExists('device_moves');
    }
};
