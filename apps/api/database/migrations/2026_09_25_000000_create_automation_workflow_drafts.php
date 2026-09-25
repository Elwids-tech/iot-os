<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('automation_workflows', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->unsignedInteger('draft_revision')->default(1);
            $table->json('workflow');
            $table->json('definition');
            $table->string('definition_hash', 64);
            $table->foreignId('updated_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->index(['organization_id', 'id']);
        });
        Schema::create('automation_workflow_revisions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('automation_workflow_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('revision');
            $table->json('snapshot');
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('created_at');
            $table->unique(['automation_workflow_id', 'revision']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('automation_workflow_revisions');
        Schema::dropIfExists('automation_workflows');
    }
};
