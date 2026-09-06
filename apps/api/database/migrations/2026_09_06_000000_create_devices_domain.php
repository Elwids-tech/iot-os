<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sparkplug_connections', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->string('group_id')->unique();
            $table->string('host_id')->unique();
            $table->string('username')->unique();
            $table->text('password');
            $table->string('status')->default('provisioning');
            $table->text('diagnostic')->nullable();
            $table->timestampsTz();
        });
        Schema::create('sparkplug_gateways', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('sparkplug_connection_id')->constrained()->restrictOnDelete();
            $table->string('edge_node_id');
            $table->string('name');
            $table->string('username')->nullable()->unique();
            $table->text('password')->nullable();
            $table->string('presence')->default('unseen');
            $table->string('session_id')->nullable();
            $table->timestampTz('last_seen_at')->nullable();
            $table->timestampsTz();
            $table->unique(['sparkplug_connection_id', 'edge_node_id']);
        });
        Schema::create('device_discovery_candidates', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('sparkplug_gateway_id')->constrained()->restrictOnDelete();
            // Empty denotes the Edge Node's own measurements, never a wildcard.
            $table->string('source_device_id')->default('');
            $table->string('status')->default('pending');
            $table->string('presence')->default('unseen');
            $table->string('session_id')->nullable();
            $table->unsignedInteger('birth_revision')->default(0);
            $table->jsonb('metrics');
            $table->timestampTz('last_seen_at')->nullable();
            $table->timestampsTz();
            $table->unique(['sparkplug_gateway_id', 'source_device_id'], 'discovered_source_unique');
        });
        Schema::create('devices', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->string('code');
            $table->string('name');
            $table->string('serial_number')->nullable();
            $table->text('description')->nullable();
            $table->string('lifecycle')->default('registered');
            $table->string('presence')->default('unseen');
            $table->string('deployment_status')->default('idle');
            $table->unsignedInteger('draft_revision')->default(1);
            $table->unsignedInteger('deployment_generation')->default(0);
            $table->jsonb('draft')->nullable();
            $table->foreignId('device_discovery_candidate_id')->nullable()->constrained()->restrictOnDelete();
            // A source stays reserved until deactivation is acknowledged and the record archived.
            $table->uuid('reserved_source_uuid')->nullable()->unique();
            $table->uuid('desired_configuration_uuid')->nullable();
            $table->uuid('applied_configuration_uuid')->nullable();
            $table->text('diagnostic')->nullable();
            $table->timestampTz('last_seen_at')->nullable();
            $table->timestampTz('runtime_seen_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['organization_id', 'code']);
        });
        Schema::create('device_configurations', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_profile_artifact_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('revision');
            $table->string('definition_hash', 64);
            $table->jsonb('definition');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['device_id', 'revision']);
        });
        Schema::create('device_commands', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('device_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_configuration_id')->constrained()->restrictOnDelete();
            $table->uuid('parameter_uuid');
            $table->uuid('idempotency_key');
            $table->jsonb('value');
            $table->string('status')->default('prepared');
            $table->string('outstanding_key')->nullable()->unique();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->text('diagnostic')->nullable();
            $table->timestampsTz();
            $table->unique(['device_id', 'idempotency_key']);
        });
        Schema::create('device_outbox', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('type');
            $table->jsonb('payload');
            $table->uuid('lease_token')->nullable();
            $table->timestampTz('leased_until')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->timestampTz('created_at');
            $table->index(['published_at', 'leased_until']);
        });
        Schema::create('device_inbox', function (Blueprint $table): void {
            $table->uuid('uuid')->primary();
            $table->string('type');
            $table->timestampTz('received_at');
        });
        Schema::create('device_audit_events', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('resource_uuid')->nullable();
            $table->string('action');
            $table->jsonb('details');
            $table->timestampTz('created_at');
        });
        Schema::create('telemetry_retention_settings', function (Blueprint $table): void {
            $table->id();
            $table->string('scope_key')->unique();
            $table->foreignId('organization_id')->nullable()->constrained()->restrictOnDelete();
            $table->unsignedInteger('days')->nullable();
            $table->unsignedInteger('revision')->default(1);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        foreach (['telemetry_retention_settings', 'device_audit_events', 'device_inbox', 'device_outbox', 'device_commands', 'device_configurations', 'devices', 'device_discovery_candidates', 'sparkplug_gateways', 'sparkplug_connections'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
