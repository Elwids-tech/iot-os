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

        Schema::create('device_definition_assignments', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_id');
            $table->foreignId('device_profile_version_id');
            $table->foreignId('transport_binding_version_id');
            $table->unsignedInteger('revision')->default(1);
            $table->timestampTz('locked_at')->nullable();
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique('device_id');
            $table->unique(['organization_id', 'id'], 'device_assignments_org_id_unique');
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
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE devices ADD CONSTRAINT devices_lifecycle_state_check CHECK (lifecycle_state IN ('draft', 'registered', 'archived'))");
            DB::statement('ALTER TABLE devices ADD CONSTRAINT devices_revision_check CHECK (revision > 0)');
            DB::statement('ALTER TABLE device_definition_assignments ADD CONSTRAINT device_assignments_revision_check CHECK (revision > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('device_definition_assignments');
        Schema::dropIfExists('devices');
    }
};
