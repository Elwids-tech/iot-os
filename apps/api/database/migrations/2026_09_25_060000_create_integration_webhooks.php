<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void
    {
        Schema::create('integration_webhooks', function (Blueprint $table): void {
            $table->id(); $table->uuid('uuid')->unique();
            $table->foreignId('integration_application_id')->unique()->constrained()->restrictOnDelete();
            $table->string('url', 2048); $table->text('secret');
            $table->unsignedInteger('revision')->default(1);
            $table->unsignedInteger('grant_revision');
            $table->boolean('enabled')->default(true);
            $table->unsignedBigInteger('cursor')->default(0);
            $table->timestampTz('next_dispatch_at')->nullable();
            $table->string('diagnostic')->nullable(); $table->timestampsTz();
        });
        Schema::create('integration_webhook_deliveries', function (Blueprint $table): void {
            $table->id(); $table->uuid('uuid')->unique();
            $table->foreignId('integration_webhook_id')->constrained()->restrictOnDelete();
            $table->foreignId('integration_event_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('webhook_revision');
            $table->text('body'); $table->string('status')->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            $table->unsignedInteger('attempt_limit')->default(5);
            $table->unsignedInteger('retry_revision')->default(0);
            $table->timestampTz('next_attempt_at'); $table->timestampTz('expires_at');
            $table->timestampTz('delivered_at')->nullable(); $table->string('diagnostic')->nullable();
            $table->timestampsTz();
            $table->unique(['integration_webhook_id','integration_event_id']);
        });
        Schema::create('integration_webhook_attempts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('integration_webhook_delivery_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('attempt'); $table->unsignedSmallInteger('http_status')->nullable();
            $table->string('outcome'); $table->timestampTz('created_at');
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('integration_webhook_attempts');
        Schema::dropIfExists('integration_webhook_deliveries');
        Schema::dropIfExists('integration_webhooks');
    }
};
