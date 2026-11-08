<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A device holds a place in its billing account's device limit while `limit_place_at` is
 * set (spec 029 US2, research R7): from the moment its activation is accepted until its
 * deactivation is accepted or it is archived. The rollout gives a place to every device
 * that is active, unless its deactivation is already accepted, and to every device whose
 * activation is still outstanding.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table): void {
            $table->timestampTz('limit_place_at')->nullable();
        });
        DB::statement('CREATE INDEX devices_limit_places ON devices (organization_id) WHERE limit_place_at IS NOT NULL');

        $pending = fn (string $target) => fn (Builder $operation) => $operation->selectRaw('1')
            ->from('device_operations')
            ->whereColumn('device_operations.device_id', 'devices.id')
            ->where('device_operations.status', 'pending')
            ->where('device_operations.target_state', $target);

        DB::table('devices')
            ->where(function (Builder $query) use ($pending): void {
                $query->where(fn (Builder $active) => $active->where('lifecycle', 'active')->whereNotExists($pending('inactive')))
                    ->orWhereExists($pending('active'));
            })
            ->update(['limit_place_at' => now()]);
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS devices_limit_places');
        Schema::table('devices', function (Blueprint $table): void {
            $table->dropColumn('limit_place_at');
        });
    }
};
