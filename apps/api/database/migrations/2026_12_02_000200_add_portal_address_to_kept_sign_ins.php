<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A kept sign-in started on a custom domain belongs to that domain (spec 036, research
 * R6): the address and its activation, as the session holds them. Null for one started
 * on the platform's own domain.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kept_sign_ins', function (Blueprint $table): void {
            $table->string('portal_address', 40)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('kept_sign_ins', function (Blueprint $table): void {
            $table->dropColumn('portal_address');
        });
    }
};
