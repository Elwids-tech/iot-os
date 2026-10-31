<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * The activity log replaces device_audit_events as the one audit trail (ADR-028,
 * spec 024): spatie/laravel-activitylog's schema plus the organization, the subject's
 * UUID and a name snapshot. Every old event is copied in id order, so cursors and
 * "newest first" keep their order, and the old table is dropped.
 */
return new class extends Migration
{
    // The causer type the copy writes; App\Domain\Shared\Models\User has no morph alias.
    private const USER = 'App\\Domain\\Shared\\Models\\User';

    public function up(): void
    {
        Schema::create('activity_log', function (Blueprint $table): void {
            $table->id();
            $table->string('log_name')->nullable()->index();
            $table->text('description');
            $table->nullableMorphs('subject', 'subject');
            $table->uuid('subject_uuid')->nullable();
            $table->string('subject_name')->nullable();
            $table->string('event')->nullable();
            $table->nullableMorphs('causer', 'causer');
            $table->foreignId('organization_id')->nullable()->constrained()->restrictOnDelete();
            $table->jsonb('attribute_changes')->nullable();
            $table->jsonb('properties')->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'id']);
            $table->index(['causer_id', 'id']);
            $table->index(['subject_uuid', 'created_at']);
            $table->index(['event', 'id']);
        });

        DB::statement(
            'INSERT INTO activity_log (log_name, description, event, subject_uuid, causer_type, causer_id, organization_id, properties, created_at, updated_at) '
            .'SELECT ?, action, action, resource_uuid, CASE WHEN actor_id IS NULL THEN NULL ELSE ? END, actor_id, organization_id, details, created_at, created_at '
            .'FROM device_audit_events ORDER BY id',
            ['audit', self::USER],
        );

        Schema::drop('device_audit_events');
    }

    // Copies back what the old table can hold: subjects, names and changes recorded since are lost.
    public function down(): void
    {
        Schema::create('device_audit_events', function (Blueprint $table): void {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('organization_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('resource_uuid')->nullable();
            $table->string('action');
            $table->jsonb('details');
            $table->timestampTz('created_at');
            $table->index(['resource_uuid', 'created_at']);
        });

        $users = DB::table('users')->pluck('id')->flip();

        DB::table('activity_log')->orderBy('id')->chunk(1000, function ($rows) use ($users): void {
            DB::table('device_audit_events')->insert($rows->map(fn (object $row): array => [
                'uuid' => (string) Str::uuid(),
                'organization_id' => $row->organization_id,
                'actor_id' => $row->causer_type === self::USER && $users->has($row->causer_id) ? $row->causer_id : null,
                'resource_uuid' => $row->subject_uuid,
                'action' => $row->event ?? $row->description,
                'details' => $row->properties ?? '{}',
                'created_at' => $row->created_at,
            ])->all());
        });

        Schema::drop('activity_log');
    }
};
