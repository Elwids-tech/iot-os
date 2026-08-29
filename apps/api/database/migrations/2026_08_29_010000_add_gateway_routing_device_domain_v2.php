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
        Schema::table('device_profile_versions', function (Blueprint $table): void {
            $table->string('contract_version', 2)->default('v1')->after('state');
            $table->index(
                ['organization_id', 'contract_version', 'state'],
                'profile_versions_org_contract_state_index',
            );
        });

        Schema::table('transport_binding_versions', function (Blueprint $table): void {
            $table->string('contract_version', 2)->default('v1')->after('state');
            $table->index(
                ['organization_id', 'contract_version', 'state'],
                'binding_versions_org_contract_state_index',
            );
        });

        Schema::table('devices', function (Blueprint $table): void {
            $table->string('identity_model', 24)->default('v1_direct')->after('lifecycle_state');
            $table->index(
                ['organization_id', 'identity_model', 'lifecycle_state'],
                'devices_org_identity_state_index',
            );
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

        Schema::table('device_definition_assignments', function (Blueprint $table): void {
            $table->foreignId('gateway_route_id')->nullable()->after('transport_binding_version_id');
            $table->string('compatibility_state', 32)->default('v1_unmigrated')->after('gateway_route_id');
            $table->char('profile_artifact_hash', 64)->nullable()->after('compatibility_state');
            $table->char('binding_artifact_hash', 64)->nullable()->after('profile_artifact_hash');
            $table->char('route_source_hash', 64)->nullable()->after('binding_artifact_hash');
            $table->char('runtime_bundle_hash', 64)->nullable()->after('route_source_hash');
            $table->jsonb('runtime_bundle')->nullable()->after('runtime_bundle_hash');
            $table->timestampTz('runtime_compiled_at')->nullable()->after('runtime_bundle');

            $table->unique('gateway_route_id', 'device_assignments_gateway_route_unique');
            $table->index(
                ['organization_id', 'compatibility_state'],
                'device_assignments_org_compatibility_index',
            );
            $table->foreign(
                ['organization_id', 'gateway_route_id'],
                'device_assignments_gateway_route_fk',
            )->references(['organization_id', 'id'])->on('gateway_routes')->restrictOnDelete();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE device_profile_versions ADD CONSTRAINT profile_versions_contract_check CHECK (contract_version IN ('v1', 'v2'))");
            DB::statement("ALTER TABLE transport_binding_versions ADD CONSTRAINT binding_versions_contract_check CHECK (contract_version IN ('v1', 'v2'))");
            DB::statement("ALTER TABLE devices ADD CONSTRAINT devices_identity_model_check CHECK (identity_model IN ('v1_direct', 'logical_v2'))");
            DB::statement("ALTER TABLE gateways ADD CONSTRAINT gateways_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,99}$')");
            DB::statement("ALTER TABLE gateways ADD CONSTRAINT gateways_mqtt_client_check CHECK (mqtt_client_id <> '' AND mqtt_client_id !~ '[+#]')");
            DB::statement('ALTER TABLE gateways ADD CONSTRAINT gateways_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_path_check CHECK (route_path ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$')");
            DB::statement('ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_topic_variables_check CHECK (jsonb_typeof(topic_variables) = 'object')");
            DB::statement("ALTER TABLE gateway_routes ADD CONSTRAINT gateway_routes_inbound_scopes_check CHECK (jsonb_typeof(inbound_scopes) = 'array')");
            DB::statement("ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_compatibility_check CHECK (compatibility_state IN ('v1_unmigrated', 'v2_route_pending', 'v2_route_aware'))");
            DB::statement("ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_state_shape_check CHECK ((compatibility_state = 'v1_unmigrated' AND gateway_route_id IS NULL AND profile_artifact_hash IS NULL AND binding_artifact_hash IS NULL AND route_source_hash IS NULL AND runtime_bundle_hash IS NULL AND runtime_bundle IS NULL AND runtime_compiled_at IS NULL) OR (compatibility_state = 'v2_route_pending' AND gateway_route_id IS NULL AND profile_artifact_hash IS NULL AND binding_artifact_hash IS NULL AND route_source_hash IS NULL AND runtime_bundle_hash IS NULL AND runtime_bundle IS NULL AND runtime_compiled_at IS NULL) OR (compatibility_state = 'v2_route_aware' AND gateway_route_id IS NOT NULL AND profile_artifact_hash IS NOT NULL AND binding_artifact_hash IS NOT NULL))");
            DB::statement("ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_runtime_hashes_check CHECK ((profile_artifact_hash IS NULL OR profile_artifact_hash ~ '^[a-f0-9]{64}$') AND (binding_artifact_hash IS NULL OR binding_artifact_hash ~ '^[a-f0-9]{64}$') AND (route_source_hash IS NULL OR route_source_hash ~ '^[a-f0-9]{64}$') AND (runtime_bundle_hash IS NULL OR runtime_bundle_hash ~ '^[a-f0-9]{64}$'))");
            DB::statement("ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_runtime_bundle_check CHECK (runtime_bundle IS NULL OR jsonb_typeof(runtime_bundle) = 'object')");
            DB::statement('ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_runtime_pins_check CHECK ((route_source_hash IS NULL AND runtime_bundle_hash IS NULL AND runtime_bundle IS NULL AND runtime_compiled_at IS NULL) OR (route_source_hash IS NOT NULL AND runtime_bundle_hash IS NOT NULL AND runtime_bundle IS NOT NULL AND runtime_compiled_at IS NOT NULL))');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE device_definition_assignments DROP CONSTRAINT IF EXISTS device_assignments_runtime_pins_check');
            DB::statement('ALTER TABLE device_definition_assignments DROP CONSTRAINT IF EXISTS device_assignments_runtime_bundle_check');
            DB::statement('ALTER TABLE device_definition_assignments DROP CONSTRAINT IF EXISTS device_assignments_runtime_hashes_check');
            DB::statement('ALTER TABLE device_definition_assignments DROP CONSTRAINT IF EXISTS device_assignments_state_shape_check');
            DB::statement('ALTER TABLE device_definition_assignments DROP CONSTRAINT IF EXISTS device_assignments_compatibility_check');
            DB::statement('ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_identity_model_check');
            DB::statement('ALTER TABLE transport_binding_versions DROP CONSTRAINT IF EXISTS binding_versions_contract_check');
            DB::statement('ALTER TABLE device_profile_versions DROP CONSTRAINT IF EXISTS profile_versions_contract_check');
        }

        if (DB::getDriverName() === 'sqlite') {
            Schema::table('device_definition_assignments', function (Blueprint $table): void {
                $table->dropForeign(['organization_id', 'gateway_route_id']);
            });
        } else {
            Schema::table('device_definition_assignments', function (Blueprint $table): void {
                $table->dropForeign('device_assignments_gateway_route_fk');
            });
        }

        Schema::table('device_definition_assignments', function (Blueprint $table): void {
            $table->dropUnique('device_assignments_gateway_route_unique');
            $table->dropIndex('device_assignments_org_compatibility_index');
        });

        Schema::table('device_definition_assignments', function (Blueprint $table): void {
            $table->dropColumn([
                'gateway_route_id',
                'compatibility_state',
                'profile_artifact_hash',
                'binding_artifact_hash',
                'route_source_hash',
                'runtime_bundle_hash',
                'runtime_bundle',
                'runtime_compiled_at',
            ]);
        });

        Schema::dropIfExists('gateway_routes');
        Schema::dropIfExists('gateways');

        Schema::table('devices', function (Blueprint $table): void {
            $table->dropIndex('devices_org_identity_state_index');
        });

        Schema::table('devices', function (Blueprint $table): void {
            $table->dropColumn('identity_model');
        });

        Schema::table('transport_binding_versions', function (Blueprint $table): void {
            $table->dropIndex('binding_versions_org_contract_state_index');
        });

        Schema::table('transport_binding_versions', function (Blueprint $table): void {
            $table->dropColumn('contract_version');
        });

        Schema::table('device_profile_versions', function (Blueprint $table): void {
            $table->dropIndex('profile_versions_org_contract_state_index');
        });

        Schema::table('device_profile_versions', function (Blueprint $table): void {
            $table->dropColumn('contract_version');
        });
    }
};
