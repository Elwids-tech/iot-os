<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assistant_runs', function (Blueprint $table): void {
            $table->json('help_context')->nullable();
            $table->json('help_sources')->nullable();
            $table->json('help_answer')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('assistant_runs', fn (Blueprint $table) => $table->dropColumn(['help_context', 'help_sources', 'help_answer']));
    }
};
