<?php

declare(strict_types=1);

use App\Domain\Entities\Services\EntityPermissionBackfill;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Spatie\Permission\PermissionRegistrar;

/**
 * The entity hierarchy's types, tree and change history (spec 009 PR 1,
 * data-model.md). Sites are untouched until PR 2. Whoever can view or manage
 * devices gets the matching entity permissions, so nobody gains or loses anything.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('entity_types', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->string('key', 40);
            $t->string('name', 80);
            $t->boolean('top_level')->default(false);
            $t->json('parent_type_keys');
            $t->json('member_type_keys');
            $t->boolean('accepts_devices')->default(false);
            $t->boolean('carries_timezone')->default(false);
            $t->boolean('carries_location')->default(false);
            $t->string('naming_template', 120)->nullable();
            $t->string('naming_example', 64)->nullable();
            $t->string('naming_description', 240)->nullable();
            $t->json('preset_keys');
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->unique(['organization_id', 'key']);
        });
        DB::statement('CREATE UNIQUE INDEX entity_types_name_unique ON entity_types (organization_id, lower(name))');

        Schema::create('entities', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('entity_type_id')->constrained('entity_types')->restrictOnDelete();
            $t->foreignId('parent_id')->nullable()->constrained('entities')->restrictOnDelete();
            $t->string('name', 120);
            $t->string('path_name', 64);
            $t->unsignedSmallInteger('depth');
            $t->text('path');
            $t->text('description')->nullable();
            $t->string('timezone', 64)->nullable();
            $t->text('address')->nullable();
            $t->decimal('latitude', 9, 6)->nullable();
            $t->decimal('longitude', 9, 6)->nullable();
            // Not "attributes": that name collides with Eloquent's internal attribute storage.
            $t->json('custom_attributes')->nullable();
            $t->timestamp('archived_at')->nullable();
            $t->foreignId('archived_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->index(['organization_id', 'parent_id']);
        });
        // Path names are unique among active siblings ignoring case (FR-002); an archived entity frees its name.
        DB::statement('CREATE UNIQUE INDEX entities_sibling_path_name ON entities (organization_id, coalesce(parent_id, 0), lower(path_name)) WHERE archived_at IS NULL');

        Schema::create('entity_closure', function (Blueprint $t): void {
            $t->foreignId('ancestor_id')->constrained('entities')->cascadeOnDelete();
            $t->foreignId('descendant_id')->constrained('entities')->cascadeOnDelete();
            $t->unsignedSmallInteger('depth');
            $t->primary(['ancestor_id', 'descendant_id']);
            $t->index(['descendant_id', 'depth']);
        });

        Schema::create('entity_changes', function (Blueprint $t): void {
            $t->id();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('entity_id')->constrained('entities')->cascadeOnDelete();
            $t->string('kind', 16);
            $t->foreignId('old_parent_id')->nullable()->constrained('entities')->nullOnDelete();
            $t->foreignId('new_parent_id')->nullable()->constrained('entities')->nullOnDelete();
            $t->string('old_path_name', 64)->nullable();
            $t->string('new_path_name', 64)->nullable();
            $t->foreignId('old_type_id')->nullable()->constrained('entity_types')->nullOnDelete();
            $t->foreignId('new_type_id')->nullable()->constrained('entity_types')->nullOnDelete();
            $t->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('changed_at');
            $t->index(['entity_id', 'changed_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            // Search by name and path (research R16). pg_trgm is a trusted extension the database owner may create.
            DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
            DB::statement('CREATE INDEX entities_name_trgm ON entities USING gin (lower(name) gin_trgm_ops)');
            DB::statement('CREATE INDEX entities_path_trgm ON entities USING gin (lower(path) gin_trgm_ops)');
            DB::statement("ALTER TABLE entity_changes ADD CONSTRAINT entity_changes_kind CHECK (kind IN ('created', 'moved', 'renamed', 'retyped', 'archived', 'restored'))");
        }

        app(EntityPermissionBackfill::class)->run();
    }

    public function down(): void
    {
        Schema::dropIfExists('entity_changes');
        Schema::dropIfExists('entity_closure');
        Schema::dropIfExists('entities');
        Schema::dropIfExists('entity_types');
        DB::table('permissions')->whereIn('name', ['Entity.view', 'Entity.manage', 'EntityType.manage'])->delete();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
