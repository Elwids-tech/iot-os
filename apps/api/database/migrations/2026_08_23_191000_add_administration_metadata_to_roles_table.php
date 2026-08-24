<?php

declare(strict_types=1);

use App\Domain\Authorization\Enums\OrganizationRoleName;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('roles', function (Blueprint $table): void {
            $table->string('display_name')->nullable();
            $table->boolean('is_default')->default(false);
        });

        $defaultRoleKeys = array_map(
            static fn (OrganizationRoleName $role): string => $role->value,
            OrganizationRoleName::cases(),
        );

        DB::table('roles')->orderBy('id')->eachById(function (object $role) use ($defaultRoleKeys): void {
            DB::table('roles')
                ->where('id', $role->id)
                ->update([
                    'display_name' => Str::of($role->name)->replace('-', ' ')->title()->toString(),
                    'is_default' => in_array($role->name, $defaultRoleKeys, true),
                ]);
        });
    }

    public function down(): void
    {
        Schema::table('roles', function (Blueprint $table): void {
            $table->dropColumn(['display_name', 'is_default']);
        });
    }
};
