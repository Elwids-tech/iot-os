<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('dashboards', function (Blueprint $table): void {
            $table->jsonb('tags')->default('[]');
            $table->string('folder', 60)->nullable();
        });
        Schema::create('dashboard_user', function (Blueprint $table): void {
            $table->foreignId('dashboard_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->boolean('starred')->default(false);
            $table->timestampTz('last_viewed_at')->nullable();
            $table->primary(['dashboard_id', 'user_id']);
        });
        Schema::create('dashboard_revisions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('dashboard_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('revision');
            $table->string('name');
            $table->jsonb('widgets');
            $table->jsonb('layouts');
            $table->json('defaults')->nullable();
            $table->jsonb('tags');
            $table->string('folder', 60)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->unique(['dashboard_id', 'revision']);
        });
        // Existing dashboards start their history at the current revision.
        DB::table('dashboard_revisions')->insertUsing(
            ['dashboard_id', 'revision', 'name', 'widgets', 'layouts', 'defaults', 'tags', 'folder', 'created_by', 'created_at', 'updated_at'],
            DB::table('dashboards')->select(['id', 'revision', 'name', 'widgets', 'layouts', 'defaults', 'tags', 'folder', 'updated_by', 'updated_at', 'updated_at']),
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('dashboard_revisions');
        Schema::dropIfExists('dashboard_user');
        Schema::table('dashboards', fn (Blueprint $table) => $table->dropColumn(['tags', 'folder']));
    }
};
