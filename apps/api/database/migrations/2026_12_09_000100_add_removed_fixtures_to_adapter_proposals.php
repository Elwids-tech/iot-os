<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// An assistant change may swap samples: the saved fixtures it removes when applied, so a
// full adapter (10 fixtures) can take new samples in one step.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_adapter_proposals', function (Blueprint $table): void {
            $table->json('removed_fixtures')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('device_adapter_proposals', function (Blueprint $table): void {
            $table->dropColumn('removed_fixtures');
        });
    }
};
