<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Spec 022: Laravel's database notifications, used for the alert bell. `data` is jsonb
// so the bell can filter by organization; ids are UUIDv7, so they sort by time.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('type');
            $table->morphs('notifiable');
            $table->jsonb('data');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();
            $table->index(['type', 'created_at']);
        });
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("CREATE INDEX notifications_alert_inbox ON notifications (notifiable_id, (data->>'organization_uuid'), id DESC) WHERE type = 'alert'");
            DB::statement("CREATE INDEX notifications_alert_unread ON notifications (notifiable_id, (data->>'organization_uuid'), id DESC) WHERE type = 'alert' AND read_at IS NULL");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
