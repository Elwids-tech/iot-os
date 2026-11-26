<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * An entity grouped under another outside its place in the tree, such as a feeder in a
 * division (spec 009 PR 5, FR-023). Dated; one current membership per member and group
 * type. The foreign keys to `entities` take no action, so an organization's deletion
 * cascades through `organization_id`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('entity_memberships', function (Blueprint $t): void {
            $t->id();
            $t->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $t->foreignId('member_id')->constrained('entities');
            $t->foreignId('group_id')->constrained('entities');
            $t->foreignId('group_type_id')->constrained('entity_types');
            $t->timestamp('started_at');
            $t->timestamp('ended_at')->nullable();
            $t->string('end_reason', 24)->nullable();
            $t->foreignId('started_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $t->index(['member_id', 'ended_at']);
            $t->index(['group_id', 'ended_at']);
        });
        DB::statement('CREATE UNIQUE INDEX entity_memberships_current ON entity_memberships (member_id, group_type_id) WHERE ended_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('entity_memberships');
    }
};
