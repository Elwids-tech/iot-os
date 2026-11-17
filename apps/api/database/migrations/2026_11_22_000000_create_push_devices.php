<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per browser where a person turned on push (spec 033, FR-020, FR-028). The
 * endpoint and its keys are encrypted by the model, so they are `text`: an encrypted
 * value is base64 JSON several times longer than the key it holds. At most 10 per
 * person; the model enforces it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('push_devices', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->index()->constrained()->cascadeOnDelete();
            $table->text('endpoint')->comment('Push service URL, encrypted');
            $table->char('endpoint_hash', 64)->unique()->comment('SHA-256 of the endpoint, for lookup');
            $table->text('public_key')->comment("Browser's p256dh key, encrypted");
            $table->text('auth_token')->comment("Browser's auth secret, encrypted");
            $table->string('content_encoding', 16)->default('aes128gcm');
            $table->string('label', 60);
            $table->foreignId('kept_sign_in_id')->nullable()->constrained('kept_sign_ins')->nullOnDelete();
            $table->text('session_id')->nullable()->comment('Session it was last registered or synced from, encrypted');
            $table->timestampTz('created_at');
            $table->timestampTz('last_synced_at');
            $table->timestampTz('last_reached_at')->nullable();
            $table->timestampTz('last_failed_at')->nullable();
            $table->string('last_failure', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_devices');
    }
};
