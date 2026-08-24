<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;
use LogicException;
use Spatie\Permission\PermissionRegistrar;

class OrganizationSeeder extends Seeder
{
    private const DEMO_PASSWORD = 'password';

    /**
     * @var array<string, array{name: string, users: array<int, array{name: string, email: string, role: OrganizationRoleName}>}>
     */
    private const ORGANIZATIONS = [
        'acme-manufacturing' => [
            'name' => 'Acme Manufacturing',
            'users' => [
                ['name' => 'Shared Operations Admin', 'email' => 'shared.operator@example.test', 'role' => OrganizationRoleName::ORGANIZATION_ADMIN],
                ['name' => 'Acme Moderator', 'email' => 'acme.moderator@example.test', 'role' => OrganizationRoleName::MODERATOR],
                ['name' => 'Acme Member', 'email' => 'acme.member@example.test', 'role' => OrganizationRoleName::MEMBER],
            ],
        ],
        'northstar-utilities' => [
            'name' => 'Northstar Utilities',
            'users' => [
                ['name' => 'Shared Operations Admin', 'email' => 'shared.operator@example.test', 'role' => OrganizationRoleName::MODERATOR],
                ['name' => 'Northstar Admin', 'email' => 'northstar.admin@example.test', 'role' => OrganizationRoleName::ORGANIZATION_ADMIN],
                ['name' => 'Northstar Member', 'email' => 'northstar.member@example.test', 'role' => OrganizationRoleName::MEMBER],
            ],
        ],
    ];

    public function run(): void
    {
        if (app()->environment('production')) {
            throw new LogicException('The demo organization seeder cannot run in production.');
        }

        $permissionRegistrar = app(PermissionRegistrar::class);
        $previousTeamId = $permissionRegistrar->getPermissionsTeamId();

        try {
            foreach (self::ORGANIZATIONS as $slug => $definition) {
                $organization = Organization::withTrashed()->firstOrNew(['slug' => $slug]);
                $organization->name = $definition['name'];
                $organization->uuid ??= (string) Str::uuid();
                $organization->saveQuietly();
                $organization->restoreQuietly();

                foreach ($definition['users'] as $userDefinition) {
                    $user = User::query()->updateOrCreate(
                        ['email' => $userDefinition['email']],
                        [
                            'name' => $userDefinition['name'],
                            'password' => self::DEMO_PASSWORD,
                            'email_verified_at' => now(),
                        ],
                    );

                    $user->organizations()->syncWithoutDetaching([$organization->id]);

                    $permissionRegistrar->setPermissionsTeamId($organization->id);

                    $role = Role::query()->firstOrCreate(
                        [
                            'organization_id' => $organization->id,
                            'name' => $userDefinition['role']->value,
                            'guard_name' => 'web',
                        ],
                    );
                    if ($role->wasRecentlyCreated) {
                        $role->forceFill([
                            'display_name' => $userDefinition['role']->displayName(),
                            'is_default' => true,
                        ])->save();

                        $role->syncPermissions($userDefinition['role']->permissions());
                    }
                    $user->syncRoles([$role]);
                }
            }
        } finally {
            $permissionRegistrar->setPermissionsTeamId($previousTeamId);
            $permissionRegistrar->forgetCachedPermissions();
        }
    }
}
