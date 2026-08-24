<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Shared\Models\User;
use Illuminate\Database\Seeder;
use LogicException;

final class SuperAdminSeeder extends Seeder
{
    private const EMAIL = 'super-admin@example.test';

    private const PASSWORD = 'password';

    public function run(): void
    {
        if (app()->environment('production')) {
            throw new LogicException('The demo super-admin seeder cannot run in production.');
        }

        User::query()->updateOrCreate(
            ['email' => self::EMAIL],
            [
                'name' => 'Platform Super Admin',
                'password' => self::PASSWORD,
                'is_super_admin' => true,
                'email_verified_at' => now(),
            ],
        );
    }
}
