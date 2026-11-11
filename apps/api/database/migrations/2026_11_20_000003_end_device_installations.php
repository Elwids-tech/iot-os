<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adapter installations end (spec 031, research R3): archiving a device ends its
 * installation, and a move ends it as `moved`, so the source can serve another device.
 * Only one installation per adapter source may be open. Installations of devices that
 * are already archived end now; those devices no longer store, so the next deploy simply
 * stops sending them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_installations', function (Blueprint $table): void {
            $table->enum('ended_reason', ['archived', 'moved'])->nullable();
            $table->dropUnique(['device_adapter_candidate_id']);
            $table->index('device_adapter_candidate_id');
        });
        DB::statement('CREATE UNIQUE INDEX device_installations_open_candidate_unique ON device_installations (device_adapter_candidate_id) WHERE ended_at IS NULL');
        DB::table('device_installations')->whereNull('ended_at')
            ->whereIn('device_id', DB::table('devices')->where('lifecycle', 'archived')->select('id'))
            ->update(['ended_at' => now(), 'ended_reason' => 'archived']);
    }

    public function down(): void
    {
        DB::statement('DROP INDEX device_installations_open_candidate_unique');
        Schema::table('device_installations', function (Blueprint $table): void {
            $table->dropIndex(['device_adapter_candidate_id']);
            $table->unique('device_adapter_candidate_id');
            $table->dropColumn('ended_reason');
        });
    }
};
