<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_workflows', function (Blueprint $table): void {
            $table->unsignedInteger('deployment_generation')->default(0);
            $table->string('deployment_status')->default('inactive');
            $table->uuid('desired_deployment_uuid')->nullable();
            $table->uuid('applied_deployment_uuid')->nullable();
            $table->uuid('pending_operation_uuid')->nullable();
        });
        Schema::create('automation_deployments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('automation_workflow_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('generation');
            $table->unsignedInteger('draft_revision');
            $table->string('target');
            $table->json('definition')->nullable();
            $table->string('definition_hash', 64)->nullable();
            $table->string('status')->default('pending');
            $table->string('stopped_reason')->nullable();
            $table->text('diagnostic')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->timestampTz('completed_at')->nullable();
            $table->unique(['automation_workflow_id', 'generation']);
        });
        Schema::create('automation_transitions', function (Blueprint $table): void {
            $table->string('id', 64)->primary();
            $table->foreignId('automation_deployment_id')->constrained()->restrictOnDelete();
            $table->json('transition');
            $table->timestampTz('received_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('automation_transitions');
        Schema::dropIfExists('automation_deployments');
        Schema::table('automation_workflows', fn (Blueprint $table) => $table->dropColumn(['deployment_generation', 'deployment_status', 'desired_deployment_uuid', 'applied_deployment_uuid', 'pending_operation_uuid']));
    }
};
