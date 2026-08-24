<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Authorization\Enums\PlatformRoleName;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Seeder;
use LogicException;
use Spatie\Permission\Models\Permission;

final class PlatformRoleSeeder extends Seeder
{
    private const DEMO_EMAIL = 'platform-admin@example.test';

    private const DEMO_PASSWORD = 'password';

    public function run(): void
    {
        if (app()->environment('production')) {
            throw new LogicException('The platform role demo seeder cannot run in production.');
        }

        $roleName = PlatformRoleName::PLATFORM_ADMINISTRATOR;

        $role = PlatformRole::query()->firstOrCreate(
            ['key' => $roleName->value],
            [
                'display_name' => $roleName->displayName(),
                'is_system' => true,
            ],
        );

        $role->permissions()->sync(
            Permission::query()->whereIn('name', $roleName->permissions())->pluck('id'),
        );

        $user = User::query()->updateOrCreate(
            ['email' => self::DEMO_EMAIL],
            [
                'name' => 'Platform Administrator',
                'password' => self::DEMO_PASSWORD,
                'email_verified_at' => now(),
            ],
        );

        $user->platformRoles()->syncWithoutDetaching([$role->id]);
    }
}
