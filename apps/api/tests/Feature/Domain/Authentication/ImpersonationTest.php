<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\TwoStepFixtures;
use Tests\TestCase;

/**
 * Super administrators sign in as someone else from the admin app and leave to return
 * to the admin page they started from.
 */
final class ImpersonationTest extends TestCase
{
    use RefreshDatabase, TwoStepFixtures;

    private User $superAdmin;

    private User $member;

    private string $secret;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ValidateCsrfToken::class);
        config(['app.admin_url' => 'http://localhost:5174', 'sanctum.stateful' => ['localhost', 'localhost:5173', 'localhost:5174']]);
        $this->superAdmin = User::factory()->create(['is_super_admin' => true, 'password' => 'password', 'email' => 'root@example.test']);
        // Super administrators must use two-step sign-in.
        [$this->secret] = $this->turnOnTwoStep($this->superAdmin);
        $this->member = User::factory()->create(['name' => 'Ana Silva', 'email' => 'ana@example.test']);
        $this->member->organizations()->attach(Organization::factory()->create());
    }

    public function test_a_super_administrator_becomes_the_person_and_leaves_back_to_where_they_started(): void
    {
        $this->signIn($this->superAdmin);

        $this->start($this->member, 'http://localhost:5174/users?search=ana')->assertNoContent();
        $this->assertAuthenticatedAs($this->member, 'web');

        $this->browser('GET', '/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.email', 'ana@example.test')
            ->assertJsonPath('data.is_super_admin', false)
            ->assertJsonPath('data.impersonation.impersonator.id', $this->superAdmin->id)
            ->assertJsonPath('data.impersonation.impersonator.name', $this->superAdmin->name);

        $this->browser('DELETE', '/api/v1/auth/impersonation')
            ->assertOk()
            ->assertJsonPath('data.return_url', 'http://localhost:5174/users?search=ana');
        $this->assertAuthenticatedAs($this->superAdmin, 'web');

        $this->browser('GET', '/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.id', $this->superAdmin->id)
            ->assertJsonPath('data.impersonation', null);

        $this->assertSame(1, $this->audit('user.impersonation_started'));
        $this->assertSame(1, $this->audit('user.impersonation_ended'));
    }

    public function test_only_super_administrators_impersonate(): void
    {
        $platformAdministrator = User::factory()->create(['password' => 'password']);
        $this->signIn($platformAdministrator);

        $this->start($this->member)->assertForbidden();
        $this->assertAuthenticatedAs($platformAdministrator, 'web');
    }

    public function test_guests_cannot_impersonate_or_leave(): void
    {
        $this->start($this->member)->assertUnauthorized();
        $this->browser('DELETE', '/api/v1/auth/impersonation')->assertUnauthorized();
    }

    public function test_super_administrators_and_yourself_cannot_be_impersonated(): void
    {
        $other = User::factory()->create(['is_super_admin' => true]);
        $this->signIn($this->superAdmin);

        $this->start($other)->assertUnprocessable()->assertJsonValidationErrors('user');
        $this->start($this->superAdmin)->assertUnprocessable()->assertJsonValidationErrors('user');
        $this->assertAuthenticatedAs($this->superAdmin, 'web');
    }

    public function test_leaving_without_impersonating_is_refused(): void
    {
        $this->signIn($this->superAdmin);

        $this->browser('DELETE', '/api/v1/auth/impersonation')->assertUnprocessable();
        $this->assertAuthenticatedAs($this->superAdmin, 'web');
    }

    public function test_a_return_address_outside_the_platform_apps_goes_back_to_the_admin_home(): void
    {
        $this->signIn($this->superAdmin);
        $this->start($this->member, 'https://evil.example.com/phish')->assertNoContent();

        $this->browser('DELETE', '/api/v1/auth/impersonation')
            ->assertOk()
            ->assertJsonPath('data.return_url', 'http://localhost:5174');
    }

    public function test_the_persons_sign_in_security_stays_theirs_while_impersonated(): void
    {
        $this->signIn($this->superAdmin);
        // A password the super administrator confirmed does not carry over.
        $this->browser('POST', '/api/v1/auth/confirm-password', ['password' => 'password'])->assertSuccessful();
        $this->start($this->member)->assertNoContent();

        $this->browser('POST', '/api/v1/me/two-step')
            ->assertForbidden()
            ->assertJsonPath('code', 'impersonating');
        $this->browser('POST', '/api/v1/auth/confirm-password', ['password' => 'password'])
            ->assertForbidden()
            ->assertJsonPath('code', 'impersonating');
        $this->browser('POST', '/api/v1/agent-authorizations/approve')
            ->assertForbidden()
            ->assertJsonPath('code', 'impersonating');
    }

    public function test_required_two_step_does_not_stop_the_super_administrator(): void
    {
        $organization = $this->member->organizations()->firstOrFail();
        $organization->forceFill(['two_step_required' => true])->save();
        $this->signIn($this->superAdmin);
        $this->start($this->member)->assertNoContent();

        $this->browser('GET', "/api/v1/organizations/{$organization->uuid}/context")->assertOk();
    }

    public function test_what_the_super_administrator_does_as_the_person_is_marked_in_the_audit_log(): void
    {
        $this->signIn($this->superAdmin);
        $this->start($this->member)->assertNoContent();

        // The request's session and user are what the audit log reads.
        $this->browser('GET', '/api/v1/me')->assertOk();
        ActivityLog::record('organization.updated', null, $this->member);

        $this->assertSame(
            $this->superAdmin->id,
            (int) DB::table('activity_log')->where('event', 'organization.updated')->value('properties->impersonated_by'),
        );
    }

    public function test_leaving_after_losing_super_administrator_access_signs_out(): void
    {
        $this->signIn($this->superAdmin);
        $this->start($this->member)->assertNoContent();
        $this->superAdmin->forceFill(['is_super_admin' => false])->save();

        $this->browser('DELETE', '/api/v1/auth/impersonation')
            ->assertOk()
            ->assertJsonPath('data.return_url', 'http://localhost:5174');
        $this->assertGuest('web');
    }

    private function signIn(User $user): void
    {
        $response = $this->browser('POST', '/api/v1/auth/login', ['email' => $user->email, 'password' => 'password']);
        if ($user->is($this->superAdmin)) {
            $response->assertAccepted();
            $this->browser('POST', '/api/v1/auth/two-step', ['code' => $this->totp($this->secret)])->assertOk();
        } else {
            $response->assertOk();
        }
    }

    private function start(User $user, ?string $returnUrl = null): TestResponse
    {
        return $this->browser('POST', "/api/v1/admin/users/{$user->id}/impersonation", ['return_url' => $returnUrl]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function browser(string $method, string $uri, array $data = []): TestResponse
    {
        return $this->withHeader('Origin', 'http://localhost')->json($method, $uri, $data);
    }

    private function audit(string $event): int
    {
        return DB::table('activity_log')
            ->where('event', $event)
            ->where('causer_id', $this->superAdmin->id)
            ->where('properties->user_id', $this->member->id)
            ->count();
    }
}
