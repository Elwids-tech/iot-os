<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_adapter_tenants', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->unique()->constrained()->cascadeOnDelete();
            $t->unsignedInteger('listen_port')->unique();
            $t->text('runtime_token');
            $t->text('ingress_admin_password');
            $t->string('status')->default('pending');
            $t->text('diagnostic')->nullable();
            $t->text('ca_certificate')->nullable();
            $t->string('broker_url')->nullable();
            $t->timestamps();
        });
        Schema::create('device_adapters', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_profile_artifact_id')->constrained()->restrictOnDelete();
            $t->foreignId('sparkplug_gateway_id')->nullable()->constrained()->restrictOnDelete();
            $t->string('name');
            $t->unsignedInteger('draft_revision')->default(1);
            $t->text('code');
            $t->json('fixtures');
            $t->json('source');
            $t->text('secrets')->nullable();
            $t->uuid('applied_revision_uuid')->nullable();
            $t->uuid('desired_revision_uuid')->nullable();
            $t->string('status')->default('draft');
            $t->text('diagnostic')->nullable();
            $t->json('health')->nullable();
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
        });
        Schema::create('device_adapter_revisions', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->unsignedInteger('revision');
            $t->string('content_hash', 64);
            $t->json('definition');
            $t->text('secret_snapshot');
            $t->json('test_result')->nullable();
            $t->timestamp('tested_at')->nullable();
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
            $t->unique(['device_adapter_id', 'revision']);
        });
        Schema::create('device_adapter_candidates', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->string('source_device_id', 128);
            $t->string('sparkplug_device_id', 80);
            $t->json('preview');
            $t->timestamp('last_seen_at');
            $t->string('status')->default('discovered');
            $t->timestamps();
            $t->unique(['device_adapter_id', 'source_device_id']);
        });
        Schema::create('device_installations', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_id')->constrained()->restrictOnDelete();
            $t->foreignId('device_adapter_candidate_id')->unique()->constrained()->restrictOnDelete();
            $t->uuid('adapter_revision_uuid');
            $t->string('manufacturer_serial', 128);
            $t->timestamp('started_at');
            $t->timestamp('ended_at')->nullable();
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
        });
        Schema::create('device_adapter_operations', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->uuid('revision_uuid')->nullable();
            $t->string('action');
            $t->string('status')->default('queued');
            $t->text('diagnostic')->nullable();
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
        });
        Schema::create('device_adapter_credentials', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->string('username')->unique();
            $t->text('password');
            $t->timestamp('revoked_at')->nullable();
            $t->foreignId('created_by')->constrained('users');
            $t->timestamps();
        });
        Schema::create('device_adapter_proposals', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->uuid('conversation_id');
            $t->foreignId('user_id')->constrained('users');
            $t->unsignedInteger('draft_revision');
            $t->text('code');
            $t->string('summary', 1000);
            $t->json('evidence');
            $t->string('content_hash', 64);
            $t->string('status')->default('pending');
            $t->timestamps();
        });
        Schema::table('assistant_conversations', fn (Blueprint $t) => $t->foreignId('device_adapter_id')->nullable()->constrained()->nullOnDelete());
    }

    public function down(): void
    {
        Schema::table('assistant_conversations', fn (Blueprint $t) => $t->dropConstrainedForeignId('device_adapter_id'));
        foreach (['device_adapter_proposals', 'device_adapter_credentials', 'device_adapter_operations', 'device_installations', 'device_adapter_candidates', 'device_adapter_revisions', 'device_adapters', 'device_adapter_tenants'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
