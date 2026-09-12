<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dashboards', function (Blueprint $table): void {
            $table->unsignedInteger('revision')->default(1);
            $table->json('defaults')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('dashboards', fn (Blueprint $table) => $table->dropColumn(['revision', 'defaults']));
    }
};
