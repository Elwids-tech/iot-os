<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assistant_runs', function (Blueprint $table): void {
            $table->json('execution_context')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('assistant_runs', function (Blueprint $table): void {
            $table->dropColumn('execution_context');
        });
    }
};
