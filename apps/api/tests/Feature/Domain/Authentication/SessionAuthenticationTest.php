<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\PermissionRegistrar;
use Tests\TestCase;

final class SessionAuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_cannot_access_the_current_user_endpoint(): void
    {
        $this->getJson('/api/v1/me')
            ->assertUnauthorized();
    }

    public function test_a_user_can_login_and_load_their_organizations(): void
    {
        $this->withoutMiddleware(ValidateCsrfToken::class);

        $organization = Organization::factory()->create();
        $user = User::factory()->create([
            'email' => 'operator@example.test',
            'password' => 'password',
        ]);
        $user->organizations()->attach($organization);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', [
                'email' => 'operator@example.test',
                'password' => 'password',
            ])
            ->assertOk()
            ->assertJsonPath('data.email', 'operator@example.test')
            ->assertJsonPath('data.organizations.0.uuid', $organization->uuid);

        $this->assertAuthenticatedAs($user, 'web');

        $this->withHeader('Origin', 'http://localhost')
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.organizations.0.slug', $organization->slug);
    }

    public function test_repeated_failed_logins_are_throttled_per_account_and_address(): void
    {
        $this->withoutMiddleware(ValidateCsrfToken::class);
        User::factory()->create(['email' => 'operator@example.test', 'password' => 'password']);
        $attempt = fn (string $email, string $ip = '203.0.113.7') => $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'wrong-password']);

        foreach (range(1, 5) as $ignored) {
            $attempt('operator@example.test')->assertUnprocessable();
        }
        $attempt('Operator@Example.test ')->assertTooManyRequests()
            ->assertHeader('Retry-After')
            ->assertJsonPath('message', fn (string $message) => str_starts_with($message, 'Too many sign-in attempts. Try again in '));

        // Another account from the same address, and the same account from another
        // address, are unaffected: one attacker cannot lock a real user out everywhere.
        $attempt('someone@example.test')->assertUnprocessable();
        $attempt('operator@example.test', '198.51.100.9')->assertUnprocessable();
    }

    public function test_one_address_cannot_spray_many_accounts(): void
    {
        $this->withoutMiddleware(ValidateCsrfToken::class);
        foreach (range(1, 30) as $n) {
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.8'])->withHeader('Origin', 'http://localhost')
                ->postJson('/api/v1/auth/login', ['email' => "user{$n}@example.test", 'password' => 'wrong-password'])
                ->assertUnprocessable();
        }
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.8'])->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => 'user31@example.test', 'password' => 'wrong-password'])
            ->assertTooManyRequests();
    }

    public function test_invalid_credentials_are_rejected(): void
    {
        $this->withoutMiddleware(ValidateCsrfToken::class);

        User::factory()->create([
            'email' => 'operator@example.test',
            'password' => 'password',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'operator@example.test',
            'password' => 'incorrect-password',
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $this->assertGuest('web');
    }

    public function test_a_user_can_logout(): void
    {
        $this->withoutMiddleware(ValidateCsrfToken::class);

        $user = User::factory()->create([
            'email' => 'operator@example.test',
            'password' => 'password',
        ]);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', [
                'email' => 'operator@example.test',
                'password' => 'password',
            ])
            ->assertOk();

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/logout')
            ->assertOk()
            ->assertJsonPath('message', 'Logged out.');

        $this->assertGuest('web');
        $this->withHeader('Origin', 'http://localhost')
            ->getJson('/api/v1/me')
            ->assertUnauthorized();
    }

    public function test_a_member_can_resolve_an_organization_context(): void
    {
        $organization = Organization::factory()->create();
        $user = User::factory()->create();
        $user->organizations()->attach($organization);

        $this->actingAs($user, 'web')
            ->getJson("/api/v1/organizations/{$organization->uuid}/context")
            ->assertOk()
            ->assertJsonPath('data.uuid', $organization->uuid)
            ->assertJsonPath('data.slug', $organization->slug);

        $this->assertNull(app(PermissionRegistrar::class)->getPermissionsTeamId());
    }

    public function test_a_user_cannot_resolve_an_organization_they_do_not_belong_to(): void
    {
        $organization = Organization::factory()->create();
        $user = User::factory()->create();

        $this->actingAs($user, 'web')
            ->getJson("/api/v1/organizations/{$organization->uuid}/context")
            ->assertForbidden();
    }
}
