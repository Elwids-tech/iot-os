<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_roles', function (Blueprint $table): void {
            $table->id();
            $table->string('key')->unique();
            $table->string('display_name');
            $table->boolean('is_system')->default(true);
            $table->timestamps();
        });

        Schema::create('platform_role_permission', function (Blueprint $table): void {
            $table->foreignId('platform_role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('permission_id')->constrained()->cascadeOnDelete();
            $table->primary(['platform_role_id', 'permission_id']);
        });

        Schema::create('platform_role_user', function (Blueprint $table): void {
            $table->foreignId('platform_role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->primary(['platform_role_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_role_user');
        Schema::dropIfExists('platform_role_permission');
        Schema::dropIfExists('platform_roles');
    }
};
