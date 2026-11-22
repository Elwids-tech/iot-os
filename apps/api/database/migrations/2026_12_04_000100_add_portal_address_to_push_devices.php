<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A push device remembers the portal address it was turned on at (spec 036, research
 * R12): a tap opens on that address, so alerts of another account's organizations are
 * not sent there. Null for a device turned on at the platform's own address, which
 * still gets everything.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('push_devices', function (Blueprint $table): void {
            $table->foreignId('portal_address_id')->nullable()->constrained('portal_addresses')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('push_devices', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('portal_address_id');
        });
    }
};
