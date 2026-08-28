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
        Schema::create('device_profiles', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->string('key', 100);
            $table->string('name', 160);
            $table->text('description')->nullable();
            $table->unsignedInteger('revision')->default(1);
            $table->timestampTz('archived_at')->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'device_profiles_org_id_unique');
            $table->unique(['organization_id', 'key'], 'device_profiles_org_key_unique');
        });

        Schema::create('device_profile_versions', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_profile_id');
            $table->unsignedInteger('version');
            $table->string('state', 20)->default('draft');
            $table->jsonb('definition');
            $table->unsignedInteger('revision')->default(1);
            $table->jsonb('artifact')->nullable();
            $table->char('artifact_hash', 64)->nullable();
            $table->char('source_hash', 64)->nullable();
            $table->jsonb('compiler')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->timestampTz('retired_at')->nullable();
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'profile_versions_org_id_unique');
            $table->unique(['device_profile_id', 'version'], 'profile_versions_number_unique');
            $table->index('created_by_id', 'profile_versions_created_by_index');
            $table->foreign(
                ['organization_id', 'device_profile_id'],
                'profile_versions_profile_fk',
            )->references(['organization_id', 'id'])->on('device_profiles')->restrictOnDelete();
        });

        Schema::create('transport_bindings', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_profile_id');
            $table->string('key', 100);
            $table->string('name', 160);
            $table->text('description')->nullable();
            $table->string('transport', 50)->default('native_mqtt_json');
            $table->unsignedInteger('revision')->default(1);
            $table->timestampTz('archived_at')->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'transport_bindings_org_id_unique');
            $table->unique(['organization_id', 'key'], 'transport_bindings_org_key_unique');
            $table->index('device_profile_id', 'transport_bindings_profile_index');
            $table->foreign(
                ['organization_id', 'device_profile_id'],
                'transport_bindings_profile_fk',
            )->references(['organization_id', 'id'])->on('device_profiles')->restrictOnDelete();
        });

        Schema::create('transport_binding_versions', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('transport_binding_id');
            $table->foreignId('device_profile_version_id');
            $table->unsignedInteger('version');
            $table->string('state', 20)->default('draft');
            $table->jsonb('definition');
            $table->unsignedInteger('revision')->default(1);
            $table->jsonb('artifact')->nullable();
            $table->char('artifact_hash', 64)->nullable();
            $table->char('source_hash', 64)->nullable();
            $table->jsonb('compiler')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->timestampTz('retired_at')->nullable();
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'binding_versions_org_id_unique');
            $table->unique(['transport_binding_id', 'version'], 'binding_versions_number_unique');
            $table->index('device_profile_version_id', 'binding_versions_profile_version_index');
            $table->index('created_by_id', 'binding_versions_created_by_index');
            $table->foreign(
                ['organization_id', 'transport_binding_id'],
                'binding_versions_binding_fk',
            )->references(['organization_id', 'id'])->on('transport_bindings')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'device_profile_version_id'],
                'binding_versions_profile_version_fk',
            )->references(['organization_id', 'id'])->on('device_profile_versions')->restrictOnDelete();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE device_profiles ADD CONSTRAINT device_profiles_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,99}$')");
            DB::statement('ALTER TABLE device_profiles ADD CONSTRAINT device_profiles_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE device_profile_versions ADD CONSTRAINT profile_versions_state_check CHECK (state IN ('draft', 'published', 'retired'))");
            DB::statement('ALTER TABLE device_profile_versions ADD CONSTRAINT profile_versions_revision_check CHECK (version > 0 AND revision > 0)');
            DB::statement("ALTER TABLE device_profile_versions ADD CONSTRAINT profile_versions_hash_check CHECK ((artifact_hash IS NULL OR artifact_hash ~ '^[a-f0-9]{64}$') AND (source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$'))");
            DB::statement("ALTER TABLE transport_bindings ADD CONSTRAINT transport_bindings_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,99}$')");
            DB::statement("ALTER TABLE transport_bindings ADD CONSTRAINT transport_bindings_transport_check CHECK (transport = 'native_mqtt_json')");
            DB::statement('ALTER TABLE transport_bindings ADD CONSTRAINT transport_bindings_revision_check CHECK (revision > 0)');
            DB::statement("ALTER TABLE transport_binding_versions ADD CONSTRAINT binding_versions_state_check CHECK (state IN ('draft', 'published', 'retired'))");
            DB::statement('ALTER TABLE transport_binding_versions ADD CONSTRAINT binding_versions_revision_check CHECK (version > 0 AND revision > 0)');
            DB::statement("ALTER TABLE transport_binding_versions ADD CONSTRAINT binding_versions_hash_check CHECK ((artifact_hash IS NULL OR artifact_hash ~ '^[a-f0-9]{64}$') AND (source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('transport_binding_versions');
        Schema::dropIfExists('transport_bindings');
        Schema::dropIfExists('device_profile_versions');
        Schema::dropIfExists('device_profiles');
    }
};
