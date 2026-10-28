<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Spec 020: HTTP webhook and polling adapter sources, their diagnostics, and the
// device onboarding assistant that replaces the adapter assistant.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_adapters', function (Blueprint $t): void {
            $t->string('ingest_id', 40)->nullable()->unique();
            $t->json('poll_state')->nullable();
            $t->unsignedInteger('cursor_generation')->default(0);
            $t->timestamp('cursor_start')->nullable();
        });
        Schema::create('device_adapter_webhook_secrets', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->string('label', 80);
            $t->string('origin', 16);
            $t->text('secret');
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('last_used_at')->nullable();
            $t->timestamp('expires_at')->nullable();
            $t->timestamp('revoked_at')->nullable();
            $t->timestamps();
            $t->index(['device_adapter_id', 'revoked_at']);
        });
        Schema::create('device_adapter_deliveries', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->string('kind', 16);
            $t->string('reason', 40)->nullable();
            $t->string('source', 16);
            $t->timestamp('received_at');
            $t->string('source_address', 45)->nullable();
            $t->string('path', 512)->nullable();
            $t->string('content_type', 255)->nullable();
            $t->unsignedInteger('size')->default(0);
            $t->string('delivery_id', 64)->nullable();
            $t->string('error', 300)->nullable();
            $t->json('input')->nullable();
            $t->string('report_id', 80)->nullable();
            $t->timestamp('created_at')->nullable();
            $t->index(['device_adapter_id', 'kind', 'received_at']);
            $t->unique(['device_adapter_id', 'report_id']);
        });
        Schema::create('device_adapter_outcome_counts', function (Blueprint $t): void {
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->timestamp('bucket');
            $t->string('outcome', 32);
            $t->unsignedBigInteger('count')->default(0);
            $t->primary(['device_adapter_id', 'bucket', 'outcome']);
        });
        // Report identifiers already applied, so a retried report never counts twice.
        Schema::create('device_adapter_reports', function (Blueprint $t): void {
            $t->string('report_id', 80)->primary();
            $t->timestamp('created_at');
        });
        Schema::create('device_adapter_poll_runs', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_adapter_id')->constrained()->cascadeOnDelete();
            $t->string('run_id', 64);
            $t->uuid('revision_uuid')->nullable();
            $t->timestamp('started_at');
            $t->timestamp('finished_at')->nullable();
            $t->string('outcome', 16);
            $t->unsignedSmallInteger('http_status')->nullable();
            $t->unsignedInteger('pages')->default(0);
            $t->unsignedInteger('records')->default(0);
            $t->unsignedInteger('published')->default(0);
            $t->unsignedInteger('failed')->default(0);
            $t->unsignedInteger('duplicates')->default(0);
            $t->string('cursor_before', 512)->nullable();
            $t->string('cursor_after', 512)->nullable();
            $t->string('error', 300)->nullable();
            $t->timestamp('next_attempt_at')->nullable();
            $t->timestamps();
            $t->unique(['device_adapter_id', 'run_id']);
            $t->index(['device_adapter_id', 'started_at']);
        });
        Schema::table('device_adapter_proposals', function (Blueprint $t): void {
            $t->foreignId('organization_id')->nullable()->constrained()->cascadeOnDelete();
            $t->string('kind', 16)->default('change');
            $t->string('name')->nullable();
            $t->uuid('artifact_uuid')->nullable();
            $t->json('source')->nullable();
            $t->json('fixtures')->nullable();
        });
        Schema::table('device_adapter_proposals', function (Blueprint $t): void {
            $t->foreignId('device_adapter_id')->nullable()->change();
            $t->text('code')->nullable()->change();
            $t->unsignedInteger('draft_revision')->nullable()->change();
        });
        DB::table('device_adapter_proposals')->update(['organization_id' => DB::raw('(SELECT organization_id FROM device_adapters WHERE device_adapters.id = device_adapter_proposals.device_adapter_id)')]);
        DB::table('assistant_conversations')->where('scope', 'adapter')->update(['scope' => 'onboarding']);
    }

    public function down(): void
    {
        DB::table('assistant_conversations')->where('scope', 'onboarding')->whereNotNull('device_adapter_id')->update(['scope' => 'adapter']);
        DB::table('device_adapter_proposals')->whereNull('device_adapter_id')->delete();
        Schema::table('device_adapter_proposals', function (Blueprint $t): void {
            $t->dropConstrainedForeignId('organization_id');
            $t->dropColumn(['kind', 'name', 'artifact_uuid', 'source', 'fixtures']);
        });
        foreach (['device_adapter_poll_runs', 'device_adapter_reports', 'device_adapter_outcome_counts', 'device_adapter_deliveries', 'device_adapter_webhook_secrets'] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::table('device_adapters', function (Blueprint $t): void {
            $t->dropUnique(['ingest_id']);
            $t->dropColumn(['ingest_id', 'poll_state', 'cursor_generation', 'cursor_start']);
        });
    }
};
