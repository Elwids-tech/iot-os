<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Whoever activates an adapter-fed device chooses whether the readings its source
 * reported before the activation are kept as its first readings. Off by default.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_installations', function (Blueprint $table): void {
            $table->boolean('keeps_last_readings')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('device_installations', function (Blueprint $table): void {
            $table->dropColumn('keeps_last_readings');
        });
    }
};
