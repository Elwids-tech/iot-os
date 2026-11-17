<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Organizations whose pushes a person switched off (spec 033, FR-019). No row means on,
 * which covers organizations the person joins later.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('push_organization_mutes', function (Blueprint $table): void {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('created_at');
            $table->primary(['user_id', 'organization_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_organization_mutes');
    }
};
