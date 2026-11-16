<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per **Keep me signed in** sign-in on one browser or installed app (spec 033,
 * FR-011a, research R11). Laravel's remember token is one per user and logout cycles
 * it, so it cannot end one device alone; this table can.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kept_sign_ins', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->index()->constrained()->cascadeOnDelete();
            $table->char('secret_hash', 64)->comment("SHA-256 of the cookie's secret; the secret is never stored");
            $table->string('label', 120);
            $table->timestampTz('created_at');
            $table->timestampTz('expires_at')->index()->comment('created_at + 30 days; never extended');
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('ended_at')->nullable();
            $table->string('end_reason', 32)->nullable()->comment('signed_out, password_reset or device_removed');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kept_sign_ins');
    }
};
