<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_alerts', function (Blueprint $table): void {
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('assigned_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('automation_alerts', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('assigned_to');
            $table->dropColumn('assigned_at');
        });
    }
};
