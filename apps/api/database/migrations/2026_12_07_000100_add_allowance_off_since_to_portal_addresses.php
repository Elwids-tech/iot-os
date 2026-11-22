<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When the scheduled check first found a live address without its account's allowance
 * (spec 036, FR-037, T102). Cleared when the allowance is back; an address still
 * without it 30 days later is released.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('portal_addresses', function (Blueprint $table): void {
            $table->timestamp('allowance_off_since')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('portal_addresses', function (Blueprint $table): void {
            $table->dropColumn('allowance_off_since');
        });
    }
};
