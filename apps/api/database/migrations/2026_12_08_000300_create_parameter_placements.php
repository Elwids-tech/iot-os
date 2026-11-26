<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One device parameter placed at an entity under a leaf name, overriding the device's
 * placement for that parameter (spec 009 PR 4, FR-010). The parameter is referenced by
 * its stable UUID without a foreign key, so history survives profile edits.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('parameter_placements', function (Blueprint $t): void {
            $t->id();
            $t->uuid('uuid')->unique();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('device_id')->constrained('devices')->cascadeOnDelete();
            $t->uuid('parameter_uuid');
            $t->string('parameter_key', 128);
            $t->foreignId('entity_id')->constrained('entities');
            $t->string('leaf_name', 64);
            $t->timestamp('started_at')->nullable();
            $t->timestamp('ended_at')->nullable();
            $t->string('end_reason', 24)->nullable();
            $t->foreignId('started_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $t->index(['device_id', 'ended_at']);
        });
        DB::statement('CREATE UNIQUE INDEX parameter_placements_current ON parameter_placements (device_id, parameter_uuid) WHERE ended_at IS NULL');
        DB::statement('CREATE INDEX parameter_placements_current_entity ON parameter_placements (entity_id) WHERE ended_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('parameter_placements');
    }
};
