<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When a custom domain's certificate expires, as last read from the deployment's proxy,
 * and when it was last looked for (spec 036, T101). Both null for a name, which the
 * deployment's wildcard certificate covers, and where there is no proxy to ask.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('portal_addresses', function (Blueprint $table): void {
            $table->timestamp('certificate_expires_at')->nullable();
            $table->timestamp('certificate_checked_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('portal_addresses', function (Blueprint $table): void {
            $table->dropColumn(['certificate_expires_at', 'certificate_checked_at']);
        });
    }
};
