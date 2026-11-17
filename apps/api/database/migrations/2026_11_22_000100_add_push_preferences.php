<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A person's push levels and switch (spec 033, FR-019). Push has its own revision so
 * the email and push forms never refuse each other's saves. `push_levels` stays null
 * until push is first turned on, which then sets every activation level and leaves
 * Cleared off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notification_preferences', function (Blueprint $table): void {
            $table->boolean('push_enabled')->default(false);
            $table->jsonb('push_levels')->nullable()->comment('{"critical","warning","info","recovery"} booleans');
            $table->integer('push_revision')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('notification_preferences', function (Blueprint $table): void {
            $table->dropColumn(['push_enabled', 'push_levels', 'push_revision']);
        });
    }
};
