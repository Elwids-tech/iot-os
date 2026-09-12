<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assistant_budgets', function (Blueprint $table): void {
            $table->date('day')->primary();
            $table->decimal('spent_usd', 10, 6)->default(0);
            $table->decimal('reserved_usd', 10, 6)->default(0);
        });
        Schema::create('assistant_conversations', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('device_profile_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid('sdk_conversation_id')->nullable();
            $table->json('sdk_pending_approvals')->nullable();
            $table->string('title')->default('New profile conversation');
            $table->json('onboarding_state')->nullable();
            $table->timestamps();
            $table->index(['organization_id', 'user_id', 'updated_at']);
        });
        Schema::create('assistant_sources', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('conversation_id')->constrained('assistant_conversations')->cascadeOnDelete();
            $table->string('name');
            $table->string('mime');
            $table->string('path');
            $table->unsignedBigInteger('size');
            $table->string('sha256', 64);
            $table->unsignedInteger('pages')->nullable();
            $table->timestamps();
        });
        Schema::create('assistant_runs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('conversation_id')->constrained('assistant_conversations')->cascadeOnDelete();
            $table->uuid('request_id');
            $table->string('status')->default('queued');
            $table->text('prompt')->nullable();
            $table->json('source_ids')->nullable();
            $table->json('decisions')->nullable();
            $table->text('answer')->nullable();
            $table->json('usage')->nullable();
            $table->decimal('cost_usd', 10, 6)->default(0);
            $table->decimal('reserved_usd', 10, 6)->default(0);
            $table->string('error_code')->nullable();
            $table->text('error_message')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->unique(['conversation_id', 'request_id']);
            $table->index(['status', 'created_at']);
        });
        Schema::create('assistant_events', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignUuid('conversation_id')->constrained('assistant_conversations')->cascadeOnDelete();
            $table->foreignUuid('run_id')->nullable()->constrained('assistant_runs')->cascadeOnDelete();
            $table->string('type');
            $table->json('payload');
            $table->timestamp('created_at')->useCurrent();
            $table->index(['conversation_id', 'id']);
        });
        Schema::create('assistant_proposals', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('conversation_id')->constrained('assistant_conversations')->cascadeOnDelete();
            $table->foreignUuid('run_id')->nullable()->constrained('assistant_runs')->nullOnDelete();
            $table->string('section');
            $table->string('status')->default('pending');
            $table->string('summary');
            $table->unsignedInteger('draft_revision')->nullable();
            $table->string('content_hash', 64);
            $table->json('changes');
            $table->json('before');
            $table->json('evidence')->nullable();
            $table->json('diagnostics')->nullable();
            $table->string('approval_id')->nullable();
            $table->json('result')->nullable();
            $table->timestamps();
        });
        Schema::create('assistant_profile_audits', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('device_profile_id')->constrained()->cascadeOnDelete();
            $table->uuid('proposal_id')->unique();
            $table->string('content_hash', 64);
            $table->unsignedInteger('draft_revision');
            $table->json('changes');
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        foreach (['assistant_profile_audits', 'assistant_proposals', 'assistant_events', 'assistant_runs', 'assistant_sources', 'assistant_conversations'] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::dropIfExists('assistant_budgets');
    }
};
