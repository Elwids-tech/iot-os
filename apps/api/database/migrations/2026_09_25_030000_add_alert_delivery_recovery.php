<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_alert_deliveries', function (Blueprint $table): void {
            $table->unsignedInteger('retry_generation')->default(0);
            $table->unsignedInteger('cycle_attempts')->default(0);
        });
        DB::table('automation_alert_deliveries')->update(['cycle_attempts' => DB::raw('attempts')]);
    }

    public function down(): void
    {
        Schema::table('automation_alert_deliveries', fn (Blueprint $table) => $table->dropColumn(['retry_generation', 'cycle_attempts']));
    }
};
