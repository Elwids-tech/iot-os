<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Administration;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class PlatformDirectoryApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_platform_administrators_can_search_and_filter_the_user_directory(): void
    {
        $this->seed(DatabaseSeeder::class);

        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();

        $this->actingAs($administrator)
            ->getJson('/api/v1/admin/users?search=Shared&organization='.$organization->uuid.'&per_page=1')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('meta.per_page', 1)
            ->assertJsonPath('data.0.email', 'shared.operator@example.test')
            ->assertJsonPath('data.0.organizations.0.slug', 'acme-manufacturing')
            ->assertJsonPath('data.0.organizations.1.slug', 'northstar-utilities');
    }

    public function test_platform_administrators_can_search_and_filter_organization_roles(): void
    {
        $this->seed(DatabaseSeeder::class);

        $administrator = User::query()->where('email', 'platform-admin@example.test')->firstOrFail();
        $organization = Organization::query()->where('slug', 'northstar-utilities')->firstOrFail();

        $this->actingAs($administrator)
            ->getJson('/api/v1/admin/roles?search=Moderator&organization='.$organization->uuid)
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.key', 'moderator')
            ->assertJsonPath('data.0.display_name', 'Moderator')
            ->assertJsonPath('data.0.is_default', true)
            ->assertJsonPath('data.0.organization.slug', 'northstar-utilities');
    }

    public function test_super_admins_can_read_directories_and_organization_only_users_cannot(): void
    {
        $this->seed(DatabaseSeeder::class);

        $superAdmin = User::query()->where('email', 'super-admin@example.test')->firstOrFail();
        $organizationUser = User::query()->where('email', 'shared.operator@example.test')->firstOrFail();

        $this->actingAs($superAdmin)
            ->getJson('/api/v1/admin/users?search=super-admin')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.is_super_admin', true);

        $this->actingAs($organizationUser)
            ->getJson('/api/v1/admin/users')
            ->assertForbidden();

        $this->actingAs($organizationUser)
            ->getJson('/api/v1/admin/roles')
            ->assertForbidden();
    }
}
