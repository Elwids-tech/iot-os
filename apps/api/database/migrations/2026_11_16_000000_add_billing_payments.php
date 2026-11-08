<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Card payments (spec 029 US7, ADR-037). A billing account is a Stripe customer and
 * keeps only its card's brand, last four digits and expiry for display; card numbers
 * never reach the platform. Payments only move forward, and each Stripe event is acted
 * on once (`billing_provider_events`, pruned after 30 days).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->string('stripe_id')->nullable()->index();
            $table->string('pm_type')->nullable();
            $table->string('pm_last_four', 4)->nullable();
            // `YYYY-MM`.
            $table->string('pm_expires', 7)->nullable();
            // Set when an invoice passes its due date unpaid; nothing is restricted (FR-043).
            $table->timestampTz('past_due_since')->nullable();
        });

        Schema::create('billing_payments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('invoice_id')->constrained('billing_invoices')->restrictOnDelete();
            $table->bigInteger('amount');
            // card, checkout or outside.
            $table->string('method', 16);
            // The PaymentIntent's id.
            $table->string('provider_reference')->nullable()->unique();
            // 1 at issue, 2 on the due date, 3 seven days after; 0 for checkout and outside.
            $table->unsignedSmallInteger('attempt')->default(0);
            // pending, succeeded or failed.
            $table->string('status', 16);
            $table->text('failure_reason')->nullable();
            $table->text('note')->nullable();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('status_at');
            $table->timestampsTz();
            $table->index(['invoice_id', 'status']);
        });

        Schema::create('billing_provider_events', function (Blueprint $table): void {
            $table->string('provider_event_id')->primary();
            $table->string('type', 64);
            $table->timestampTz('received_at')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_provider_events');
        Schema::dropIfExists('billing_payments');
        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->dropIndex(['stripe_id']);
            $table->dropColumn(['stripe_id', 'pm_type', 'pm_last_four', 'pm_expires', 'past_due_since']);
        });
    }
};
