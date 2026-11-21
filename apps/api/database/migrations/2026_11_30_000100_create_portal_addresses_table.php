<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Portal addresses (spec 036, ADR-050, data-model.md): a name under the platform's
 * domain, or a custom domain, on which a billing account's branded portal is served.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('portal_addresses', function (Blueprint $table): void {
            $table->id();
            $table->uuid()->unique();
            // Kept after a release so a renamed name can redirect and its account can take it back.
            $table->foreignId('billing_account_id')->nullable()->constrained('billing_accounts')->nullOnDelete();
            $table->string('kind', 16);
            // Lower case, without a port. Unique across every state: a released name is held.
            $table->string('host', 253)->unique();
            $table->string('state', 16);
            $table->string('claim_token', 32)->nullable();
            $table->foreignId('claimed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('suspended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('claimed_at')->nullable();
            $table->timestampTz('activated_at')->nullable();
            $table->timestampTz('last_checked_at')->nullable();
            $table->timestampTz('last_reachable_at')->nullable();
            $table->smallInteger('failed_checks')->default(0);
            $table->timestampTz('unreachable_since')->nullable();
            $table->timestampTz('suspended_at')->nullable();
            $table->timestampTz('released_at')->nullable();
            $table->foreignId('redirect_to_id')->nullable()->constrained('portal_addresses')->nullOnDelete();
            $table->timestampsTz();
        });

        // One live name and one live domain per account (FR-012).
        DB::statement("CREATE UNIQUE INDEX portal_addresses_one_live_per_kind ON portal_addresses (billing_account_id, kind) WHERE state NOT IN ('released', 'lapsed')");
    }

    public function down(): void
    {
        Schema::dropIfExists('portal_addresses');
    }
};
