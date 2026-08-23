<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        $this->withoutMiddleware(VerifyCsrfToken::class);

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

    public function test_invalid_credentials_are_rejected(): void
    {
        $this->withoutMiddleware(VerifyCsrfToken::class);

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
        $this->withoutMiddleware(VerifyCsrfToken::class);

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
}
