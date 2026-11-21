<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Uploaded brand images and their stored sizes (spec 036, data-model.md). An asset
 * belongs to a billing account (a brand's logo or icon) or to an organization (its
 * logo), never both.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('brand_assets', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('billing_account_id')->nullable()->constrained('billing_accounts')->cascadeOnDelete();
            $table->foreignId('organization_id')->nullable()->constrained('organizations')->cascadeOnDelete();
            $table->string('role', 16);
            // SHA-256 of the re-encoded original; its first 12 characters are in the public URL.
            $table->char('content_hash', 64);
            $table->jsonb('variants');
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            // Set when a newer image takes its place; pruned a day later.
            $table->timestampTz('replaced_at')->nullable()->index();
            $table->timestampsTz();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE brand_assets ADD CONSTRAINT brand_assets_one_owner CHECK ((billing_account_id IS NULL) <> (organization_id IS NULL))');
            DB::statement("ALTER TABLE brand_assets ADD CONSTRAINT brand_assets_role CHECK (role IN ('logo', 'logo_dark', 'icon'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('brand_assets');
    }
};
