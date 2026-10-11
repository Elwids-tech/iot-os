<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_inbox', function (Blueprint $table): void {
            $table->index('received_at');
        });
    }

    public function down(): void
    {
        Schema::table('device_inbox', function (Blueprint $table): void {
            $table->dropIndex(['received_at']);
        });
    }
};
