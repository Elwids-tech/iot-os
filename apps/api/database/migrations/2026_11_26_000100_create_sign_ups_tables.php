<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Self sign-up (spec 035, data-model.md): one row per attempt, and one row of settings.
 * Nothing but the attempt exists until its email is confirmed (research R2).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sign_ups', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('name', 120);
            $table->string('email', 255);
            $table->string('organization_name', 80);
            // The account's bcrypt hash until completion; never set on a refused attempt.
            $table->string('password')->nullable();
            $table->string('state', 16);
            $table->string('refusal_reason', 32)->nullable();
            $table->char('token_hash', 64)->nullable();
            $table->timestampTz('token_expires_at')->nullable();
            $table->unsignedSmallInteger('sends')->default(0);
            $table->timestampTz('last_sent_at')->nullable();
            $table->ipAddress('ip_address')->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('signed_in_at')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
            $table->foreignId('billing_account_id')->nullable()->constrained('billing_accounts')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['state', 'created_at']);
        });

        // One waiting sign-up per address (FR-015), and each link's token once.
        DB::statement("CREATE UNIQUE INDEX sign_ups_waiting_email_unique ON sign_ups (email) WHERE state = 'waiting'");
        DB::statement('CREATE UNIQUE INDEX sign_ups_token_hash_unique ON sign_ups (token_hash) WHERE token_hash IS NOT NULL');

        Schema::create('sign_up_settings', function (Blueprint $table): void {
            $table->id();
            // Closed until platform staff open it (FR-025).
            $table->boolean('open')->default(false);
            $table->boolean('free_beta')->default(true);
            $table->boolean('notify_push')->default(true);
            $table->boolean('notify_email')->default(false);
            $table->unsignedInteger('daily_limit')->default(50);
            $table->unsignedInteger('revision')->default(1);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::table('sign_up_settings')->insert(['id' => 1]);
    }

    public function down(): void
    {
        Schema::dropIfExists('sign_up_settings');
        Schema::dropIfExists('sign_ups');
    }
};
