<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AI agent access (spec 004). Passport owns clients and tokens; a connection binds
 * one person's client to one organization and access level. Organizations start
 * switched off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table): void {
            $table->boolean('agent_access_enabled')->default(false);
            $table->timestamp('agent_access_changed_at')->nullable();
        });

        Schema::create('agent_connections', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('oauth_client_id')->constrained('oauth_clients')->restrictOnDelete();
            $table->string('access_level', 8);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at');
            $table->timestamp('revoked_at')->nullable();
            $table->foreignId('revoked_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('revoked_reason', 32)->nullable();
            $table->timestamps();
            $table->index(['organization_id', 'revoked_at']);
        });

        Schema::create('agent_activity', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('agent_connection_id')->constrained()->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('tool', 64);
            $table->jsonb('targets')->default('[]');
            $table->string('outcome', 16);
            $table->string('reason', 64)->nullable();
            $table->unsignedInteger('duration_ms');
            $table->timestamp('created_at');
            $table->index(['organization_id', 'created_at']);
            $table->index(['agent_connection_id', 'created_at']);
        });

        Schema::create('agent_proposal_groups', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('agent_connection_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 160);
            $table->string('status', 8)->default('open');
            $table->timestamps();
        });

        Schema::create('agent_proposals', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('agent_proposal_group_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 32);
            $table->uuid('target_uuid')->nullable();
            $table->unsignedInteger('base_revision')->nullable();
            $table->string('summary', 240);
            $table->jsonb('payload');
            $table->jsonb('before')->nullable();
            $table->jsonb('diagnostics')->default('[]');
            $table->jsonb('depends_on')->nullable();
            $table->char('content_hash', 64);
            $table->string('status', 16)->default('open');
            $table->foreignId('applied_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('applied_at')->nullable();
            $table->jsonb('result')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();
            $table->index(['agent_proposal_group_id', 'status']);
        });

        // One active connection per person and client; revoked rows stay as history.
        // SQLite (tests) and Postgres both support partial unique indexes.
        DB::statement('CREATE UNIQUE INDEX agent_connections_active_client ON agent_connections (user_id, oauth_client_id) WHERE revoked_at IS NULL');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE agent_connections ADD CONSTRAINT agent_connections_access_level CHECK (access_level IN ('read', 'draft'))");
            DB::statement("ALTER TABLE agent_connections ADD CONSTRAINT agent_connections_revoked_reason CHECK (revoked_reason IS NULL OR revoked_reason IN ('person', 'administrator', 'membership_removed', 'password_reset', 'refresh_reuse', 'replaced'))");
            DB::statement("ALTER TABLE agent_activity ADD CONSTRAINT agent_activity_outcome CHECK (outcome IN ('answered', 'refused', 'failed'))");
            DB::statement("ALTER TABLE agent_proposal_groups ADD CONSTRAINT agent_proposal_groups_status CHECK (status IN ('open', 'done'))");
            DB::statement("ALTER TABLE agent_proposals ADD CONSTRAINT agent_proposals_kind CHECK (kind IN ('profile_section', 'decoder_revision', 'device_registration', 'dashboard'))");
            DB::statement("ALTER TABLE agent_proposals ADD CONSTRAINT agent_proposals_status CHECK (status IN ('open', 'applied', 'discarded', 'expired', 'superseded'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_proposals');
        Schema::dropIfExists('agent_proposal_groups');
        Schema::dropIfExists('agent_activity');
        Schema::dropIfExists('agent_connections');
        Schema::table('organizations', fn (Blueprint $table) => $table->dropColumn(['agent_access_enabled', 'agent_access_changed_at']));
    }
};
