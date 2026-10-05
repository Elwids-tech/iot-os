<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_preferences', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->boolean('email_enabled')->default(true);
            $table->unsignedInteger('revision')->default(0);
            $table->json('grid');
            $table->timestamps();
        });
        Schema::create('notification_events', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('source', 20);
            $table->string('event_key', 64)->unique();
            $table->string('incident_key', 64)->index();
            $table->foreignId('organization_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('severity', 20);
            $table->string('status', 20);
            $table->boolean('active')->default(false);
            $table->string('title');
            $table->text('summary');
            $table->string('service')->nullable();
            $table->string('environment')->nullable();
            $table->string('link')->nullable();
            $table->json('labels')->nullable();
            $table->timestamp('occurred_at');
            $table->timestamp('last_seen_at');
            $table->unsignedInteger('occurrences')->default(1);
            $table->timestamps();
            $table->index(['organization_id', 'occurred_at']);
            $table->index(['source', 'active', 'severity']);
        });
        Schema::create('notification_email_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('notification_event_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('status', 20)->default('pending');
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->unique(['notification_event_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_email_deliveries');
        Schema::dropIfExists('notification_events');
        Schema::dropIfExists('notification_preferences');
    }
};
