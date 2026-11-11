<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Onboarding rows are released (spec 031, research R7 and R14): archiving a device or
 * moving it releases its setup, so the gateway source can be onboarded again once no
 * device holds it. Only one unreleased setup per gateway source may exist. Setups of
 * devices that are already archived are released now.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_onboardings', function (Blueprint $table): void {
            $table->timestamp('released_at')->nullable();
            $table->dropUnique('onboarding_source_unique');
            $table->index(['sparkplug_gateway_id', 'source_device_id']);
        });
        DB::statement('CREATE UNIQUE INDEX onboarding_source_unique ON device_onboardings (sparkplug_gateway_id, source_device_id) WHERE released_at IS NULL');
        DB::table('device_onboardings')->whereNull('released_at')
            ->whereIn('device_id', DB::table('devices')->where('lifecycle', 'archived')->select('id'))
            ->update(['released_at' => now()]);
    }

    public function down(): void
    {
        DB::statement('DROP INDEX onboarding_source_unique');
        Schema::table('device_onboardings', function (Blueprint $table): void {
            $table->dropIndex(['sparkplug_gateway_id', 'source_device_id']);
            $table->unique(['sparkplug_gateway_id', 'source_device_id'], 'onboarding_source_unique');
            $table->dropColumn('released_at');
        });
    }
};
