<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A billing account's brand (spec 036, ADR-050): at most one per account. It takes
 * effect only while the account's `branding` allowance is on and it has a product name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('brands', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('billing_account_id')->unique()->constrained('billing_accounts')->cascadeOnDelete();
            $table->string('product_name', 40)->nullable();
            $table->string('short_name', 12)->nullable();
            $table->string('support_url', 2048)->nullable();
            $table->foreignId('logo_asset_id')->nullable()->constrained('brand_assets')->nullOnDelete();
            $table->foreignId('logo_dark_asset_id')->nullable()->constrained('brand_assets')->nullOnDelete();
            $table->foreignId('icon_asset_id')->nullable()->constrained('brand_assets')->nullOnDelete();
            $table->unsignedInteger('revision')->default(1);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('brands');
    }
};
