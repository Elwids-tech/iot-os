<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec 030: a grant is either a device list or a scope of sites. No backfill: every
// existing row keeps its device list and a null scope.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('integration_applications', function (Blueprint $table): void {
            $table->json('site_uuids')->nullable()->after('device_uuids');
        });
    }

    public function down(): void
    {
        Schema::table('integration_applications', function (Blueprint $table): void {
            $table->dropColumn('site_uuids');
        });
    }
};
