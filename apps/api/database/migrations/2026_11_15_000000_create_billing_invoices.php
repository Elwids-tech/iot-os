<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Prices, tax and invoices (spec 029 US6, research R11–R14). Amounts are integers in the
 * deployment currency's minor units. Prices change from the first day of a month; an
 * issued invoice and a credit note never change, and their numbers come from locked
 * counter rows, so a sequence has no gaps.
 */
return new class extends Migration
{
    public function up(): void
    {
        // One row: the operator's details on every invoice; the currency is config.
        Schema::create('billing_settings', function (Blueprint $table): void {
            $table->id();
            $table->string('legal_name')->nullable();
            $table->text('address')->nullable();
            $table->string('tax_registration_number', 64)->nullable();
            $table->text('invoice_footer')->nullable();
            $table->string('invoice_prefix', 16)->default('INV-');
            $table->string('credit_note_prefix', 16)->default('CN-');
            $table->unsignedInteger('revision')->default(0);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::table('billing_settings')->insert(['id' => 1]);

        Schema::create('billing_tax_rates', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('name')->unique();
            $table->unsignedInteger('basis_points');
            $table->timestampTz('archived_at')->nullable();
            $table->timestampsTz();
        });

        // Month M uses the latest row with effective_from ≤ M; no row is a price of 0.
        Schema::create('billing_plan_prices', function (Blueprint $table): void {
            $table->foreignId('billing_plan_id')->constrained('billing_plans')->cascadeOnDelete();
            $table->date('effective_from');
            $table->unsignedBigInteger('base_price')->default(0);
            $table->unsignedBigInteger('alert_overage_price')->default(0);
            $table->unsignedBigInteger('data_point_overage_price')->default(0);
            $table->unsignedInteger('data_point_block_size')->default(1_000_000);
            $table->foreignId('set_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at')->nullable();
            $table->primary(['billing_plan_id', 'effective_from']);
        });

        // A null value removes the override from effective_from.
        Schema::create('billing_price_overrides', function (Blueprint $table): void {
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->string('price', 32);
            $table->date('effective_from');
            $table->unsignedBigInteger('value')->nullable();
            $table->text('note')->nullable();
            $table->foreignId('set_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at')->nullable();
            $table->primary(['billing_account_id', 'price', 'effective_from']);
        });

        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->text('billing_address')->nullable();
            $table->string('tax_number', 64)->nullable();
            $table->unsignedBigInteger('billing_tax_rate_id')->nullable();
        });
        // Rates are archived, never deleted, so an account keeps the one it has. SQLite adds a
        // foreign key by rebuilding the table, and dropping billing_accounts on the way
        // cascades to its children; PostgreSQL adds the constraint in place.
        if (DB::getDriverName() === 'pgsql') {
            Schema::table('billing_accounts', function (Blueprint $table): void {
                $table->foreign('billing_tax_rate_id')->references('id')->on('billing_tax_rates')->restrictOnDelete();
            });
        }

        Schema::create('billing_invoices', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->restrictOnDelete();
            $table->date('month');
            $table->string('status', 16);
            $table->string('number', 32)->nullable()->unique();
            $table->boolean('usage_incomplete')->default(false);
            $table->text('draft_note')->nullable();
            $table->char('currency', 3);
            $table->json('operator_details')->nullable();
            $table->json('account_details')->nullable();
            $table->string('tax_rate_name')->nullable();
            $table->unsignedInteger('tax_basis_points')->nullable();
            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax')->default(0);
            $table->bigInteger('total')->default(0);
            $table->bigInteger('credit_applied')->default(0);
            $table->bigInteger('amount_due')->default(0);
            $table->timestampTz('due_at')->nullable();
            $table->string('payment_status', 24)->default('pending');
            $table->foreignId('drafted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('drafted_at');
            $table->foreignId('issued_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('issued_at')->nullable();
            $table->timestampsTz();
            $table->unique(['billing_account_id', 'month']);
            $table->index(['status', 'month']);
            $table->index('payment_status');
        });

        Schema::create('billing_invoice_lines', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('invoice_id')->constrained('billing_invoices')->cascadeOnDelete();
            $table->unsignedInteger('position');
            $table->string('kind', 24);
            $table->string('description');
            $table->decimal('quantity', 18, 4)->default(1);
            $table->bigInteger('unit_price')->nullable();
            $table->bigInteger('amount');
            $table->date('period_start')->nullable();
            $table->date('period_end')->nullable();
            $table->foreignId('plan_assignment_id')->nullable()->constrained('billing_plan_assignments')->restrictOnDelete();
            $table->text('note')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->index(['invoice_id', 'position']);
        });

        // Each organization's usage, snapshotted when drafted or recalculated.
        Schema::create('billing_invoice_usage', function (Blueprint $table): void {
            $table->foreignId('invoice_id')->constrained('billing_invoices')->cascadeOnDelete();
            $table->uuid('organization_uuid');
            $table->string('organization_name');
            $table->string('kind', 32);
            $table->unsignedBigInteger('count');
            $table->primary(['invoice_id', 'organization_uuid', 'kind']);
        });

        // `applied` is the part taken off the invoice; the rest went to account credit.
        Schema::create('billing_credit_notes', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('invoice_id')->constrained('billing_invoices')->restrictOnDelete();
            $table->string('number', 32)->unique();
            $table->bigInteger('amount');
            $table->bigInteger('applied');
            $table->text('reason');
            $table->foreignId('issued_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('issued_at');
        });

        // The balance is the sum: credit notes add, issued invoices take.
        Schema::create('billing_account_credits', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('billing_account_id')->constrained('billing_accounts')->cascadeOnDelete();
            $table->bigInteger('amount');
            $table->foreignId('credit_note_id')->nullable()->constrained('billing_credit_notes')->restrictOnDelete();
            $table->foreignId('invoice_id')->nullable()->constrained('billing_invoices')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->index('billing_account_id');
        });

        // Issuing locks the row: a rolled-back issue gives its number back.
        Schema::create('billing_number_sequences', function (Blueprint $table): void {
            $table->string('name', 32)->primary();
            $table->unsignedBigInteger('next');
        });
        DB::table('billing_number_sequences')->insert([['name' => 'invoice', 'next' => 1], ['name' => 'credit_note', 'next' => 1]]);
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_number_sequences');
        Schema::dropIfExists('billing_account_credits');
        Schema::dropIfExists('billing_credit_notes');
        Schema::dropIfExists('billing_invoice_usage');
        Schema::dropIfExists('billing_invoice_lines');
        Schema::dropIfExists('billing_invoices');
        if (DB::getDriverName() === 'pgsql') {
            Schema::table('billing_accounts', function (Blueprint $table): void {
                $table->dropForeign(['billing_tax_rate_id']);
            });
        }
        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->dropColumn(['billing_address', 'tax_number', 'billing_tax_rate_id']);
        });
        Schema::dropIfExists('billing_price_overrides');
        Schema::dropIfExists('billing_plan_prices');
        Schema::dropIfExists('billing_tax_rates');
        Schema::dropIfExists('billing_settings');
    }
};
