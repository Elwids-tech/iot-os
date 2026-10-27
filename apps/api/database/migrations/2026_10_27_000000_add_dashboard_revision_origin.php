<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records which versions the assistant made (spec 019); `agent` is reserved for agent
 * drafts (spec 004). Null for everything a person saved, including every existing version.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dashboard_revisions', function (Blueprint $table): void {
            $table->string('origin', 16)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('dashboard_revisions', function (Blueprint $table): void {
            $table->dropColumn('origin');
        });
    }
};
