<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Data points reported by the runtime (spec 029 US3, ADR-036): the highest cumulative
 * count seen per organization and UTC hour, with the billing account the hour belongs
 * to, and the runtime's finality watermark. Buckets name the organization by uuid only,
 * so deleting an organization leaves them; `billing:prune` removes them after 13 months.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('billing_data_point_buckets', function (Blueprint $table): void {
            $table->uuid('organization_uuid');
            $table->timestampTz('hour');
            $table->unsignedBigInteger('count')->default(0);
            // Fixed when the bucket is first seen; null for an organization that no longer exists.
            $table->foreignId('billing_account_id')->nullable()->constrained('billing_accounts')->nullOnDelete();
            $table->timestampTz('updated_at')->nullable();
            $table->primary(['organization_uuid', 'hour']);
            $table->index('hour');
        });

        Schema::create('billing_usage_watermarks', function (Blueprint $table): void {
            $table->string('source', 16)->primary();
            // Every hour that ends at or before this instant is final. It only moves forward.
            $table->timestampTz('final_through');
            $table->timestampTz('reported_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_usage_watermarks');
        Schema::dropIfExists('billing_data_point_buckets');
    }
};
