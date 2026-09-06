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
            $table->foreignId('organization_id')->nullable()->constrained()->nullOnDelete();
            $table->string('code');
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('category')->nullable();
            $table->string('status')->default('draft');
            $table->unsignedInteger('revision')->default(0);
            $table->unsignedInteger('draft_revision')->default(1);
            $table->char('definition_hash', 64)->nullable();
            $table->jsonb('extensions')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();

            $table->unique(['organization_id', 'code']);
            $table->index('organization_id');
            $table->index('status');
            $table->index('category');
        });

        // SQL treats NULL values as distinct in a compound unique index. This
        // partial index gives platform-owned templates the same scoped-code
        // guarantee as organization-owned profiles on PostgreSQL and SQLite.
        DB::statement('CREATE UNIQUE INDEX device_profiles_platform_code_unique ON device_profiles (code) WHERE organization_id IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('device_profiles');
    }
};
