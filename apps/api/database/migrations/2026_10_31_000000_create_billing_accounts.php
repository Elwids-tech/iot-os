<?php

use App\Domain\Billing\Services\BillingAccountBackfill;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Spec 023: every organization belongs to exactly one billing account (ADR-026). The
// current account sits on organizations; billing_account_assignments keeps the history.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_accounts', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('name');
            $table->string('contact_email')->nullable();
            $table->text('notes')->nullable();
            $table->unsignedSmallInteger('organization_limit')->default(1);
            $table->timestampsTz();
            $table->softDeletesTz();
        });

        Schema::create('billing_account_owners', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at')->nullable();
            $table->primary(['billing_account_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::table('organizations', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->nullable()->index()->constrained()->restrictOnDelete();
        });

        BillingAccountBackfill::accounts();

        Schema::table('organizations', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->nullable(false)->change();
        });

        Schema::create('billing_account_assignments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('billing_account_id')->constrained()->restrictOnDelete();
            $table->foreignId('organization_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid('organization_uuid');
            $table->string('organization_name');
            $table->timestampTz('started_at');
            $table->timestampTz('ended_at')->nullable();
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->index(['organization_uuid', 'started_at']);
            $table->index(['billing_account_id', 'started_at']);
        });

        BillingAccountBackfill::assignments();

        // One open assignment per organization.
        DB::statement('CREATE UNIQUE INDEX billing_account_assignments_open ON billing_account_assignments (organization_uuid) WHERE ended_at IS NULL');

        // An account's history reads its audit events by resource (research R11). The
        // activity log replaced this table later (spec 024) and has its own index.
        if (Schema::hasTable('device_audit_events')) {
            Schema::table('device_audit_events', function (Blueprint $table): void {
                $table->index(['resource_uuid', 'created_at']);
            });
        }
    }

    // Rolling back drops every billing account, owner and assignment; prefer a forward fix in production.
    public function down(): void
    {
        if (Schema::hasTable('device_audit_events')) {
            Schema::table('device_audit_events', function (Blueprint $table): void {
                $table->dropIndex(['resource_uuid', 'created_at']);
            });
        }

        Schema::table('organizations', function (Blueprint $table): void {
            $table->dropForeign(['billing_account_id']);
            $table->dropIndex(['billing_account_id']);
            $table->dropColumn('billing_account_id');
        });

        Schema::dropIfExists('billing_account_assignments');
        Schema::dropIfExists('billing_account_owners');
        Schema::dropIfExists('billing_accounts');
    }
};
