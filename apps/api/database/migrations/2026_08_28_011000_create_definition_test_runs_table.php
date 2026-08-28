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
        Schema::create('definition_test_runs', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_profile_version_id');
            $table->foreignId('transport_binding_version_id');
            $table->unsignedInteger('profile_revision');
            $table->unsignedInteger('binding_revision');
            $table->char('input_hash', 64);
            $table->boolean('valid');
            $table->jsonb('compiler');
            $table->jsonb('diagnostics');
            $table->jsonb('previews');
            $table->jsonb('profile_artifact')->nullable();
            $table->jsonb('binding_artifact')->nullable();
            $table->char('profile_artifact_hash', 64)->nullable();
            $table->char('binding_artifact_hash', 64)->nullable();
            $table->timestampTz('completed_at');
            $table->foreignId('created_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'id'], 'definition_runs_org_id_unique');
            $table->index(
                ['device_profile_version_id', 'transport_binding_version_id', 'valid'],
                'definition_runs_versions_valid_index',
            );
            $table->index('transport_binding_version_id', 'definition_runs_binding_version_index');
            $table->index('created_by_id', 'definition_runs_created_by_index');
            $table->foreign(
                ['organization_id', 'device_profile_version_id'],
                'definition_runs_profile_version_fk',
            )->references(['organization_id', 'id'])->on('device_profile_versions')->restrictOnDelete();
            $table->foreign(
                ['organization_id', 'transport_binding_version_id'],
                'definition_runs_binding_version_fk',
            )->references(['organization_id', 'id'])->on('transport_binding_versions')->restrictOnDelete();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE definition_test_runs ADD CONSTRAINT definition_runs_input_hash_check CHECK (input_hash ~ '^[a-f0-9]{64}$')");
            DB::statement("ALTER TABLE definition_test_runs ADD CONSTRAINT definition_runs_artifact_hash_check CHECK ((profile_artifact_hash IS NULL OR profile_artifact_hash ~ '^[a-f0-9]{64}$') AND (binding_artifact_hash IS NULL OR binding_artifact_hash ~ '^[a-f0-9]{64}$'))");
            DB::statement('ALTER TABLE definition_test_runs ADD CONSTRAINT definition_runs_revision_check CHECK (profile_revision > 0 AND binding_revision > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('definition_test_runs');
    }
};
