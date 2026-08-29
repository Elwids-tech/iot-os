<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('devices', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->string('external_id', 255);
            $table->string('name', 160);
            $table->text('description')->nullable();
            $table->string('lifecycle_state', 20)->default('draft');
            $table->unsignedInteger('revision')->default(1);
            $table->timestampTz('registered_at')->nullable();
            $table->timestampTz('archived_at')->nullable();
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'devices_org_id_unique');
            $table->unique(['organization_id', 'external_id'], 'devices_org_external_id_unique');
            $table->index('created_by_id', 'devices_created_by_index');
        });

        Schema::create('gateways', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->string('key', 100);
            $table->string('name', 160);
            $table->text('description')->nullable();
            $table->string('mqtt_client_id', 256)->unique();
            $table->unsignedInteger('revision')->default(1);
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'gateways_org_id_unique');
            $table->unique(['organization_id', 'key'], 'gateways_org_key_unique');
            $table->index('created_by_id', 'gateways_created_by_index');
            $table->index('updated_by_id', 'gateways_updated_by_index');
        });

        Schema::create('gateway_routes', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('gateway_id');
            $table->foreignId('device_id');
            $table->foreignId('device_profile_version_id');
            $table->foreignId('transport_binding_version_id');
            $table->unsignedInteger('revision')->default(1);
            $table->string('route_path', 512);
            $table->jsonb('topic_variables');
            $table->jsonb('inbound_scopes');
            $table->boolean('enabled')->default(true);
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'gateway_routes_org_id_unique');
            $table->unique(
                ['organization_id', 'gateway_id', 'route_path'],
                'gateway_routes_org_gateway_path_unique',
            );
            $table->index(
                ['organization_id', 'gateway_id', 'enabled', 'route_path'],
                'gateway_routes_resolve_index',
            );
            $table->index(
                ['organization_id', 'device_id', 'enabled'],
                'gateway_routes_device_index',
            );
            $table->index(
                ['organization_id', 'device_profile_version_id'],
                'gateway_routes_profile_version_index',
            );
            $table->index(
                ['organization_id', 'transport_binding_version_id'],
                'gateway_routes_binding_version_index',
            );
            $table->index('created_by_id', 'gateway_routes_created_by_index');
            $table->index('updated_by_id', 'gateway_routes_updated_by_index');

            $table->foreign(
                ['organization_id', 'gateway_id'],
                'gateway_routes_gateway_fk',
            )->references(['organization_id', 'id'])->on('gateways')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'device_id'],
                'gateway_routes_device_fk',
            )->references(['organization_id', 'id'])->on('devices')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'device_profile_version_id'],
                'gateway_routes_profile_version_fk',
            )->references(['organization_id', 'id'])->on('device_profile_versions')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'transport_binding_version_id'],
                'gateway_routes_binding_version_fk',
            )->references(['organization_id', 'id'])->on('transport_binding_versions')->restrictOnDelete();
        });

        Schema::create('device_definition_assignments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_id');
            $table->foreignId('device_profile_version_id');
            $table->foreignId('transport_binding_version_id');
            $table->foreignId('gateway_route_id')->nullable();
            $table->char('profile_artifact_hash', 64)->nullable();
            $table->char('binding_artifact_hash', 64)->nullable();
            $table->char('route_source_hash', 64)->nullable();
            $table->char('runtime_bundle_hash', 64)->nullable();
            $table->jsonb('runtime_bundle')->nullable();
            $table->timestampTz('runtime_compiled_at')->nullable();
            $table->unsignedInteger('revision')->default(1);
            $table->timestampTz('locked_at')->nullable();
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'device_assignments_org_id_unique');
            $table->unique('device_id', 'device_definition_assignments_device_id_unique');
            $table->unique('gateway_route_id', 'device_assignments_gateway_route_unique');
            $table->index('device_profile_version_id', 'device_assignments_profile_version_index');
            $table->index('transport_binding_version_id', 'device_assignments_binding_version_index');
            $table->index('created_by_id', 'device_assignments_created_by_index');
            $table->index('updated_by_id', 'device_assignments_updated_by_index');

            $table->foreign(
                ['organization_id', 'device_id'],
                'device_assignments_device_fk',
            )->references(['organization_id', 'id'])->on('devices')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'device_profile_version_id'],
                'device_assignments_profile_version_fk',
            )->references(['organization_id', 'id'])->on('device_profile_versions')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'transport_binding_version_id'],
                'device_assignments_binding_version_fk',
            )->references(['organization_id', 'id'])->on('transport_binding_versions')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'gateway_route_id'],
                'device_assignments_gateway_route_fk',
            )->references(['organization_id', 'id'])->on('gateway_routes')->restrictOnDelete();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE devices ADD CONSTRAINT devices_lifecycle_state_check CHECK (lifecycle_state IN ('draft', 'registered', 'archived'))");
            DB::statement('ALTER TABLE devices ADD CONSTRAINT devices_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE gateways ADD CONSTRAINT gateways_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,99}$')");
            DB::statement("ALTER TABLE gateways ADD CONSTRAINT gateways_mqtt_client_check CHECK (mqtt_client_id <> '' AND mqtt_client_id !~ '[+#]')");
            DB::statement('ALTER TABLE gateways ADD CONSTRAINT gateways_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_path_check CHECK (route_path ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$')");
            DB::statement('ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_topic_variables_check CHECK (jsonb_typeof(topic_variables) = 'object')");
            DB::statement("ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_inbound_scopes_check CHECK (jsonb_typeof(inbound_scopes) = 'array')");
            DB::statement('ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_route_shape_check CHECK ((gateway_route_id IS NULL AND profile_artifact_hash IS NULL AND binding_artifact_hash IS NULL AND route_source_hash IS NULL AND runtime_bundle_hash IS NULL AND runtime_bundle IS NULL AND runtime_compiled_at IS NULL) OR (gateway_route_id IS NOT NULL AND profile_artifact_hash IS NOT NULL AND binding_artifact_hash IS NOT NULL))");
            DB::statement("ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_runtime_hashes_check CHECK ((profile_artifact_hash IS NULL OR profile_artifact_hash ~ '^[a-f0-9]{64}$') AND (binding_artifact_hash IS NULL OR binding_artifact_hash ~ '^[a-f0-9]{64}$') AND (route_source_hash IS NULL OR route_source_hash ~ '^[a-f0-9]{64}$') AND (runtime_bundle_hash IS NULL OR runtime_bundle_hash ~ '^[a-f0-9]{64}$'))");
            DB::statement("ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_runtime_bundle_check CHECK (runtime_bundle IS NULL OR jsonb_typeof(runtime_bundle) = 'object')");
            DB::statement('ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_runtime_pins_check CHECK ((route_source_hash IS NULL AND runtime_bundle_hash IS NULL AND runtime_bundle IS NULL AND runtime_compiled_at IS NULL) OR (route_source_hash IS NOT NULL AND runtime_bundle_hash IS NOT NULL AND runtime_bundle IS NOT NULL AND runtime_compiled_at IS NOT NULL))');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('device_definition_assignments');
        Schema::dropIfExists('gateway_routes');
        Schema::dropIfExists('gateways');
        Schema::dropIfExists('devices');
    }
};
