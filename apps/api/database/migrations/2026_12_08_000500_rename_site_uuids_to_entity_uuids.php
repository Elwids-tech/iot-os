<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec 009 PR 8 (FR-026): an application's scope names entities of any type. Sites are
// already entities with the same UUIDs (PR 2), so every saved site scope carries over.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('integration_applications', function (Blueprint $table): void {
            $table->renameColumn('site_uuids', 'entity_uuids');
        });
    }

    public function down(): void
    {
        Schema::table('integration_applications', function (Blueprint $table): void {
            $table->renameColumn('entity_uuids', 'site_uuids');
        });
    }
};
