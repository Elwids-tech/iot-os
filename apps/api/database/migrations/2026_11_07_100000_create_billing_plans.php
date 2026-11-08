<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Plans and their allowances (specs 028 and 029, ADR-035). The organization limit that
 * billing accounts carried (spec 023) becomes the `organizations` allowance: an account
 * whose limit is not the default of 1 keeps it as an override, so nothing changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_plans', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->timestampTz('archived_at')->nullable();
            $table->timestampsTz();
        });
        DB::statement('CREATE UNIQUE INDEX billing_plans_name_unique ON billing_plans (lower(name))');

        Schema::create('billing_plan_allowances', function (Blueprint $table): void {
            $table->foreignId('billing_plan_id')->constrained('billing_plans')->cascadeOnDelete();
            $table->string('kind', 32);
            // NULL is unlimited; a missing row means the deployment's default.
            $table->unsignedBigInteger('value')->nullable();
            $table->primary(['billing_plan_id', 'kind']);
        });

        Schema::create('billing_allowance_overrides', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->string('kind', 32);
            $table->unsignedBigInteger('value')->nullable();
            $table->text('note');
            $table->foreignId('set_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->primary(['billing_account_id', 'kind']);
        });

        Schema::create('billing_plan_assignments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->restrictOnDelete();
            $table->foreignId('billing_plan_id')->constrained('billing_plans')->restrictOnDelete();
            $table->string('kind', 16);
            $table->timestampTz('started_at');
            $table->timestampTz('ended_at')->nullable();
            $table->timestampTz('trial_ends_at')->nullable();
            $table->string('end_reason', 32)->nullable();
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->index(['billing_account_id', 'started_at']);
            $table->index('billing_plan_id');
        });
        // One plan at a time per account.
        DB::statement('CREATE UNIQUE INDEX billing_plan_assignments_open ON billing_plan_assignments (billing_account_id) WHERE ended_at IS NULL');

        $now = now();
        DB::table('billing_accounts')
            ->where('organization_limit', '<>', 1)
            ->select(['id', 'organization_limit'])
            ->lazyById(200)
            ->each(function (object $account) use ($now): void {
                DB::table('billing_allowance_overrides')->insert([
                    'billing_account_id' => $account->id,
                    'kind' => 'organizations',
                    'value' => $account->organization_limit,
                    'note' => 'Organization limit before plans',
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            });

        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->dropColumn('organization_limit');
        });
    }

    public function down(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->unsignedSmallInteger('organization_limit')->default(1);
        });

        DB::table('billing_allowance_overrides')
            ->where('kind', 'organizations')
            ->whereNotNull('value')
            ->orderBy('billing_account_id')
            ->each(function (object $override): void {
                DB::table('billing_accounts')
                    ->where('id', $override->billing_account_id)
                    ->update(['organization_limit' => min((int) $override->value, 1000)]);
            });

        Schema::dropIfExists('billing_plan_assignments');
        Schema::dropIfExists('billing_allowance_overrides');
        Schema::dropIfExists('billing_plan_allowances');
        Schema::dropIfExists('billing_plans');
    }
};
