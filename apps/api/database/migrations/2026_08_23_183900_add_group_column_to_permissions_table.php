<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('permissions', function (Blueprint $table): void {
            $table->string('group')->after('guard_name')->nullable();
            $table->index('group');
        });
    }

    public function down(): void
    {
        Schema::table('permissions', function (Blueprint $table): void {
            $table->dropIndex('permissions_group_index');
            $table->dropColumn('group');
        });
    }
};
