<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** An organization's own logo, for light and dark appearance (spec 036 US2). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table): void {
            $table->foreignId('logo_asset_id')->nullable()->constrained('brand_assets')->nullOnDelete();
            $table->foreignId('logo_dark_asset_id')->nullable()->constrained('brand_assets')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('logo_asset_id');
            $table->dropConstrainedForeignId('logo_dark_asset_id');
        });
    }
};
