<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('automation_scenarios', function (Blueprint $t) {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('automation_workflow_id')->constrained('automation_workflows')->cascadeOnDelete();
            $t->string('name');
            $t->unsignedInteger('revision');
            $t->unsignedInteger('draft_revision');
            $t->json('definition');
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });
        Schema::create('automation_scenario_runs', function (Blueprint $t) {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('automation_scenario_id')->constrained('automation_scenarios')->cascadeOnDelete();
            $t->unsignedInteger('scenario_revision');
            $t->unsignedInteger('draft_revision');
            $t->string('definition_hash', 64);
            $t->json('scenario');
            $t->json('result');
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('automation_scenario_runs');
        Schema::dropIfExists('automation_scenarios');
    }
};
