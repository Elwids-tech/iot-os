<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_workflows', function (Blueprint $table): void {
            $table->json('notification_settings')->nullable();
            $table->unsignedInteger('notification_revision')->default(0);
        });
        Schema::create('automation_alerts', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('automation_workflow_id')->constrained()->restrictOnDelete();
            $table->foreignId('automation_deployment_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('episode');
            $table->timestampTz('activated_at')->nullable();
            $table->timestampTz('cleared_at')->nullable();
            $table->string('activation_transition_id', 64)->nullable();
            $table->string('clear_transition_id', 64)->nullable();
            $table->foreignId('acknowledged_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('acknowledged_at')->nullable();
            $table->timestampsTz();
            $table->unique(['automation_deployment_id', 'episode']);
            $table->index(['organization_id', 'id']);
        });
        Schema::create('automation_alert_comments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('automation_alert_id')->constrained()->restrictOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->text('body');
            $table->timestampTz('created_at');
        });
        Schema::create('automation_alert_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('automation_alert_id')->constrained()->restrictOnDelete();
            $table->foreignId('recipient_id')->constrained('users')->restrictOnDelete();
            $table->string('type');
            $table->string('status')->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            $table->timestampTz('sent_at')->nullable();
            $table->string('diagnostic')->nullable();
            $table->timestampsTz();
            $table->unique(['automation_alert_id', 'recipient_id', 'type'], 'alert_delivery_unique');
        });
        Schema::create('automation_alert_delivery_attempts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('automation_alert_delivery_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('attempt');
            $table->string('status');
            $table->timestampTz('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('automation_alert_delivery_attempts');
        Schema::dropIfExists('automation_alert_deliveries');
        Schema::dropIfExists('automation_alert_comments');
        Schema::dropIfExists('automation_alerts');
        Schema::table('automation_workflows', fn (Blueprint $table) => $table->dropColumn(['notification_settings', 'notification_revision']));
    }
};
