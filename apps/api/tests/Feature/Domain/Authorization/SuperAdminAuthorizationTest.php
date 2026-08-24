<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authorization;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Tests\TestCase;

final class SuperAdminAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_seeded_super_admin_bypasses_gate_checks_and_organization_membership(): void
    {
        $this->seed(DatabaseSeeder::class);

        Gate::define('platform.manage', static fn (): bool => false);

        $superAdmin = User::query()
            ->where('email', 'super-admin@example.test')
            ->firstOrFail();
        $organization = Organization::query()->firstOrFail();

        $this->assertTrue($superAdmin->is_super_admin);
        $this->assertTrue(Gate::forUser($superAdmin)->allows('platform.manage'));

        $this->actingAs($superAdmin, 'web')
            ->getJson("/api/v1/organizations/{$organization->uuid}/context")
            ->assertOk()
            ->assertJsonPath('data.uuid', $organization->uuid);
    }

    public function test_regular_users_do_not_receive_the_super_admin_gate_bypass(): void
    {
        Gate::define('platform.manage', static fn (): bool => false);

        $this->assertFalse(
            Gate::forUser(User::factory()->create())->allows('platform.manage'),
        );
    }

    public function test_super_admin_login_returns_the_global_organization_list(): void
    {
        $this->withoutMiddleware(ValidateCsrfToken::class);

        Organization::factory()->create(['name' => 'Acme Manufacturing']);
        Organization::factory()->create(['name' => 'Northstar Utilities']);
        User::factory()->create([
            'email' => 'super-admin@example.test',
            'password' => 'password',
            'is_super_admin' => true,
        ]);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', [
                'email' => 'super-admin@example.test',
                'password' => 'password',
            ])
            ->assertOk()
            ->assertJsonPath('data.is_super_admin', true)
            ->assertJsonCount(2, 'data.organizations');
    }
}
