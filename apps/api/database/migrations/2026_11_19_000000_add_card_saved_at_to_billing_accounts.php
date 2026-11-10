<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When the account's card was saved, so a trial that ended before it is charged only
 * from the day after (spec 029 FR-050, T203). Cards saved before this have none and are
 * taken as saved before any trial ended.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->timestampTz('pm_saved_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('billing_accounts', function (Blueprint $table): void {
            $table->dropColumn('pm_saved_at');
        });
    }
};
