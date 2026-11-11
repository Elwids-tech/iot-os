<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dashboards and automations come along with a move (spec 031 US2, research R11): each
 * one the move lists, the choice made for it, what it left out, and where it landed.
 * Items a move archived name it, so their lists can say why. `automation_deployments`
 * `stopped_reason` is a string and gains `moved` and `device_moved` without a change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_move_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('device_move_id')->constrained()->cascadeOnDelete();
            $table->enum('kind', ['dashboard', 'automation']);
            $table->unsignedBigInteger('source_item_id');
            $table->boolean('uses_only_moving');
            $table->enum('action', ['move', 'copy', 'keep', 'archive']);
            $table->jsonb('omitted');
            $table->unsignedBigInteger('target_item_id')->nullable();
            $table->boolean('arrives_running')->nullable();
            // What someone in the target still has to do, such as turning a moved automation on.
            $table->text('attention')->nullable();
            $table->timestampsTz();
            $table->unique(['device_move_id', 'kind', 'source_item_id']);
        });

        foreach (['dashboards', 'automation_workflows'] as $name) {
            Schema::table($name, function (Blueprint $table): void {
                $table->foreignId('archived_by_move_id')->nullable()->constrained('device_moves')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (['dashboards', 'automation_workflows'] as $name) {
            Schema::table($name, fn (Blueprint $table) => $table->dropConstrainedForeignId('archived_by_move_id'));
        }
        Schema::dropIfExists('device_move_items');
    }
};
