<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('automation_workflows', fn (Blueprint $table) => $table->foreignId('updated_by')->nullable()->change());
        Schema::table('automation_workflow_revisions', fn (Blueprint $table) => $table->foreignId('created_by')->nullable()->change());
        Schema::table('automation_deployments', fn (Blueprint $table) => $table->foreignId('created_by')->nullable()->change());
        Schema::create('device_location_bindings', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_id')->constrained()->restrictOnDelete();
            $table->uuid('configuration_uuid');
            $table->unsignedInteger('generation');
            $table->uuid('latitude_parameter_uuid');
            $table->uuid('longitude_parameter_uuid');
            $table->uuid('accuracy_parameter_uuid')->nullable();
            $table->unsignedInteger('max_age_seconds')->default(90);
            $table->unsignedInteger('max_future_skew_seconds')->default(5);
            $table->boolean('allow_unknown_accuracy')->default(true);
            $table->unsignedInteger('revision')->default(1);
            $table->foreignId('updated_by')->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
            $table->unique(['organization_id', 'device_id']);
        });

        Schema::create('geofences', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->json('geometry');
            $table->unsignedInteger('revision')->default(1);
            $table->foreignId('created_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampsTz();
            $table->index(['organization_id', 'name']);
        });

        Schema::create('geofence_assignments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('geofence_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_location_binding_id')->constrained()->restrictOnDelete();
            $table->foreignId('automation_workflow_id')->constrained()->restrictOnDelete();
            $table->json('policy');
            $table->unsignedInteger('desired_geofence_revision');
            $table->unsignedInteger('applied_geofence_revision')->nullable();
            $table->string('status')->default('inactive');
            $table->text('diagnostic')->nullable();
            $table->timestampsTz();
            $table->unique(['geofence_id', 'device_location_binding_id']);
        });

        Schema::create('geofence_activation_batches', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('geofence_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('geofence_revision');
            $table->char('request_hash', 64);
            $table->string('status')->default('pending');
            $table->foreignId('created_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->uuid('application_uuid')->nullable();
            $table->timestampsTz();
        });

        Schema::create('geofence_activation_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('geofence_activation_batch_id')->constrained()->restrictOnDelete();
            $table->foreignId('geofence_assignment_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid('assignment_uuid');
            $table->uuid('device_uuid');
            $table->uuid('operation_uuid');
            $table->string('target')->default('active');
            $table->string('status')->default('pending');
            $table->text('diagnostic')->nullable();
            $table->timestampsTz();
            $table->unique(['geofence_activation_batch_id', 'geofence_assignment_id'], 'geofence_activation_item_unique');
            $table->unique('operation_uuid');
        });

        Schema::create('geofence_events', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('geofence_id')->constrained()->restrictOnDelete();
            $table->foreignId('geofence_assignment_id')->nullable()->constrained()->nullOnDelete();
            $table->string('transition_id', 64)->unique();
            $table->string('type');
            $table->uuid('source_event_uuid')->nullable();
            $table->json('snapshot');
            $table->timestampTz('occurred_at');
            $table->timestampTz('recorded_at');
            $table->index(['organization_id', 'occurred_at']);
        });

        $this->backfill();
    }

    private function backfill(): void
    {
        DB::table('automation_workflows')->orderBy('id')->each(function ($workflow): void {
            $definition = json_decode($workflow->definition, true);
            $binding = $definition['binding'] ?? null;
            $geometry = $definition['geometry'] ?? null;
            $policy = $definition['policy'] ?? null;
            if (($definition['schema_version'] ?? null) !== 'geofence-rule.v1' || ! is_array($binding) || ! is_array($geometry) || ! is_array($policy)) {
                return;
            }
            $device = DB::table('devices')->where('organization_id', $workflow->organization_id)->where('uuid', $binding['device_uuid'] ?? '')->first();
            if (! $device) {
                return;
            }
            $now = now();
            DB::table('device_location_bindings')->updateOrInsert(
                ['organization_id' => $workflow->organization_id, 'device_id' => $device->id], [
                    'uuid' => $binding['uuid'],
                    'configuration_uuid' => $binding['configuration_uuid'], 'generation' => $binding['generation'],
                    'latitude_parameter_uuid' => $binding['latitude_parameter_uuid'], 'longitude_parameter_uuid' => $binding['longitude_parameter_uuid'],
                    'accuracy_parameter_uuid' => $binding['accuracy_parameter_uuid'], 'max_age_seconds' => $binding['max_age_seconds'],
                    'max_future_skew_seconds' => $binding['max_future_skew_seconds'], 'allow_unknown_accuracy' => $binding['allow_unknown_accuracy'],
                    'revision' => $binding['revision'], 'updated_by' => $workflow->updated_by, 'created_at' => $now, 'updated_at' => $now,
                ]);
            $bindingId = DB::table('device_location_bindings')->where('organization_id', $workflow->organization_id)->where('device_id', $device->id)->value('id');
            $fenceId = DB::table('geofences')->insertGetId([
                'uuid' => $workflow->uuid, 'organization_id' => $workflow->organization_id, 'name' => $workflow->name,
                'geometry' => json_encode($geometry, JSON_THROW_ON_ERROR), 'revision' => 1,
                'created_by' => $workflow->updated_by, 'updated_by' => $workflow->updated_by, 'created_at' => $now, 'updated_at' => $now,
            ]);
            DB::table('geofence_assignments')->insert([
                'uuid' => (string) Str::uuid(), 'organization_id' => $workflow->organization_id, 'geofence_id' => $fenceId,
                'device_location_binding_id' => $bindingId, 'automation_workflow_id' => $workflow->id,
                'policy' => json_encode($policy, JSON_THROW_ON_ERROR), 'desired_geofence_revision' => 1,
                'applied_geofence_revision' => $workflow->applied_deployment_uuid ? 1 : null,
                'status' => $workflow->deployment_status ?? 'inactive', 'created_at' => $now, 'updated_at' => $now,
            ]);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('geofence_events');
        Schema::dropIfExists('geofence_activation_items');
        Schema::dropIfExists('geofence_activation_batches');
        Schema::dropIfExists('geofence_assignments');
        Schema::dropIfExists('geofences');
        Schema::dropIfExists('device_location_bindings');
        Schema::table('automation_deployments', fn (Blueprint $table) => $table->foreignId('created_by')->nullable(false)->change());
        Schema::table('automation_workflow_revisions', fn (Blueprint $table) => $table->foreignId('created_by')->nullable(false)->change());
        Schema::table('automation_workflows', fn (Blueprint $table) => $table->foreignId('updated_by')->nullable(false)->change());
    }
};
