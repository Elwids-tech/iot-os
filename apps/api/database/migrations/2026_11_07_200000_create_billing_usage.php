<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What billing accounts use each month (spec 028 US3 and US4, ADR-035): the account's
 * totals, each organization's share, the overage per plan assignment, the device peak
 * (spec 029) and the ledger of billing emails sent. A month is the first day of a UTC
 * month.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Writers lock this row, so one account, kind and month is counted at a time.
        Schema::create('billing_usage', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->string('kind', 32);
            $table->date('month');
            $table->unsignedBigInteger('count')->default(0);
            $table->unsignedBigInteger('overage')->default(0);
            $table->timestampTz('updated_at')->nullable();
            $table->primary(['billing_account_id', 'kind', 'month']);
            $table->index(['month', 'kind']);
        });

        // Kept when the organization is deleted (OrganizationDeletion::KEPT), with its name.
        Schema::create('billing_usage_shares', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->uuid('organization_uuid');
            $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
            $table->string('organization_name');
            $table->string('kind', 32);
            $table->date('month');
            $table->unsignedBigInteger('count')->default(0);
            $table->primary(['billing_account_id', 'organization_uuid', 'kind', 'month']);
            $table->index(['organization_id', 'kind', 'month']);
        });

        // Which assignment each unit of overage happened under; a null assignment is no plan.
        Schema::create('billing_overage', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->string('kind', 32);
            $table->date('month');
            $table->foreignId('plan_assignment_id')->nullable()->constrained('billing_plan_assignments')->restrictOnDelete();
            $table->unsignedBigInteger('quantity')->default(0);
            $table->index('plan_assignment_id');
        });
        // A primary key cannot hold the nullable assignment. PostgreSQL 15+ treats nulls as
        // equal in this index; SQLite, used by the local suite, gets the same through coalesce.
        DB::statement(DB::getDriverName() === 'pgsql'
            ? 'CREATE UNIQUE INDEX billing_overage_key ON billing_overage (billing_account_id, kind, month, plan_assignment_id) NULLS NOT DISTINCT'
            : 'CREATE UNIQUE INDEX billing_overage_key ON billing_overage (billing_account_id, kind, month, coalesce(plan_assignment_id, 0))');

        Schema::create('billing_device_peaks', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->date('month');
            $table->unsignedBigInteger('peak')->default(0);
            $table->primary(['billing_account_id', 'month']);
        });

        // Each key carries its month or subject, so a pruned key is never due again.
        Schema::create('billing_notices', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->string('kind', 32);
            $table->string('key', 191);
            $table->timestampTz('sent_at');
            $table->unique(['billing_account_id', 'kind', 'key']);
            $table->index('sent_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_notices');
        Schema::dropIfExists('billing_device_peaks');
        Schema::dropIfExists('billing_overage');
        Schema::dropIfExists('billing_usage_shares');
        Schema::dropIfExists('billing_usage');
    }
};
