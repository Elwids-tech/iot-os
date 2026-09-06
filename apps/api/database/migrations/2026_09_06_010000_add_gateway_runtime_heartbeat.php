<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sparkplug_gateways', fn (Blueprint $table) => $table->timestampTz('runtime_seen_at')->nullable());
    }

    public function down(): void
    {
        Schema::table('sparkplug_gateways', fn (Blueprint $table) => $table->dropColumn('runtime_seen_at'));
    }
};
