<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Authentication;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Authorization\Models\PlatformRole;
use App\Domain\Devices\Models\Site;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Laravel\Fortify\Fortify;
use Spatie\Permission\Models\Role;
use Tests\Support\Agents\AgentFixtures;
use Tests\Support\PasskeyFixtures;
use Tests\Support\TwoStepFixtures;
use Tests\TestCase;

/** Required two-step sign-in (spec 034, US3, FR-020 to FR-023, FR-032, research R7). */
final class RequireTwoStepTest extends TestCase
{
    use AgentFixtures, PasskeyFixtures, RefreshDatabase, TwoStepFixtures;

    private Organization $acme;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
    }

    public function test_a_super_administrator_without_two_step_reaches_only_their_security_settings(): void
    {
        $admin = $this->person('super-admin@example.test');

        $this->as($admin)->getJson('/api/v1/admin/organizations')
            ->assertForbidden()
            ->assertExactJson(['code' => 'two_step_setup_required', 'message' => 'Set up two-step sign-in to continue.']);
        $this->as($admin)->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertForbidden()->assertJsonPath('code', 'two_step_setup_required');

        // Everything setup needs stays open, and `me` tells the apps to open setup.
        $this->as($admin)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.two_step_setup_required', true);
        $this->as($admin)->getJson('/api/v1/me/security')->assertOk()
            ->assertJsonPath('data.two_step.required', true)
            ->assertJsonPath('data.two_step.required_by', ['platform'])
            ->assertJsonPath('data.two_step.satisfied', false);
        $this->as($admin)->postJson('/api/v1/me/two-step')->assertStatus(423);
        $this->as($admin)->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();
        $this->as($admin)->postJson('/api/v1/me/two-step')->assertOk();
        $secret = Fortify::currentEncrypter()->decrypt($admin->refresh()->two_factor_secret);
        $this->as($admin)->getJson('/api/v1/admin/organizations')->assertForbidden();

        $this->as($admin)->postJson('/api/v1/me/two-step/confirm', ['code' => $this->totp($secret)])->assertOk();
        $this->as($admin->refresh())->getJson('/api/v1/admin/organizations')->assertOk();
        $this->as($admin)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.two_step_setup_required', false);
        $this->as($admin)->postJson('/api/v1/auth/logout')->assertOk();
    }

    public function test_platform_administrators_are_required_too(): void
    {
        $person = $this->person('acme.member@example.test');
        $this->as($person)->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertOk();

        // Made a platform administrator: sent to setup on the next request (FR-020).
        $person->platformRoles()->attach(PlatformRole::where('key', 'platform-administrator')->firstOrFail());
        $this->as($person)->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertForbidden()->assertJsonPath('code', 'two_step_setup_required');
        $this->as($person)->getJson('/api/v1/me/security')->assertOk()->assertJsonPath('data.two_step.required_by', ['platform']);

        $this->turnOnTwoStep($person);
        $this->as($person->refresh())->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertOk();
    }

    public function test_an_organization_requirement_applies_everywhere_and_lifts_when_the_person_leaves(): void
    {
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $both = $this->person('shared.operator@example.test');
        $onlyNorthstar = $this->person('northstar.member@example.test');
        $this->acme->forceFill(['two_step_required' => true])->save();

        // A requirement in Acme applies to a person in Acme and Northstar, in both.
        $this->as($both)->getJson("/api/v1/organizations/{$northstar->uuid}/context")->assertForbidden();
        $this->as($both)->getJson('/api/v1/me/security')->assertOk()
            ->assertJsonPath('data.two_step.required_by', [['organization' => $this->acme->uuid, 'name' => $this->acme->name]]);
        // Not to a person only in Northstar.
        $this->as($onlyNorthstar)->getJson("/api/v1/organizations/{$northstar->uuid}/context")->assertOk();
        $this->as($onlyNorthstar)->getJson('/api/v1/me/security')->assertOk()->assertJsonPath('data.two_step.required', false);

        // Leaving Acme lifts it, and does not turn anything off (FR-021).
        $both->organizations()->detach($this->acme);
        $this->as($both)->getJson("/api/v1/organizations/{$northstar->uuid}/context")->assertOk();
    }

    public function test_a_passkey_satisfies_the_requirement(): void
    {
        $person = $this->person('acme.member@example.test');
        $this->acme->forceFill(['two_step_required' => true])->save();
        $this->as($person)->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertForbidden();

        $this->givePasskey($person);

        $this->as($person->refresh())->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertOk();
        $this->as($person)->getJson('/api/v1/me/security')->assertOk()->assertJsonPath('data.two_step.satisfied', true);
    }

    public function test_a_required_person_with_only_a_passkey_must_finish_with_it(): void
    {
        $person = $this->person('acme.member@example.test');
        $this->acme->forceFill(['two_step_required' => true])->save();
        [$authenticator] = $this->givePasskey($person);

        // The right password starts no session: it asks for the passkey (FR-022).
        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $person->email, 'password' => 'password'])
            ->assertStatus(202)
            ->assertJsonPath('methods', ['passkey']);
        $this->assertGuest('web');
        $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/auth/two-step', ['code' => '123456'])->assertUnprocessable();
        $this->assertGuest('web');

        $options = $this->withHeader('Origin', 'http://localhost')->getJson('/api/v1/auth/passkeys/options')->assertOk()->json('options');
        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/passkeys', ['credential' => $authenticator->assert($options)])
            ->assertOk();
        $this->withHeader('Origin', 'http://localhost')->getJson("/api/v1/organizations/{$this->acme->uuid}/context")->assertOk();

        // Someone nobody requires it of still signs in with the password alone.
        $this->acme->forceFill(['two_step_required' => false])->save();
        $this->flushSession();
        $this->app['auth']->forgetGuards();
        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/v1/auth/login', ['email' => $person->email, 'password' => 'password'])
            ->assertOk();
    }

    public function test_required_two_step_cannot_be_turned_off(): void
    {
        $person = $this->person('acme.member@example.test');
        $this->turnOnTwoStep($person);
        $this->acme->forceFill(['two_step_required' => true])->save();
        $this->as($person)->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();

        $this->as($person)->deleteJson('/api/v1/me/two-step')->assertConflict()->assertJsonPath('code', 'two_step_required');
        $this->assertTrue($person->refresh()->hasEnabledTwoFactorAuthentication());

        // Once nobody requires it, the person may turn it off again.
        $this->acme->forceFill(['two_step_required' => false])->save();
        $this->as($person)->deleteJson('/api/v1/me/two-step')->assertNoContent();
    }

    public function test_an_unconfirmed_setup_can_still_be_discarded_while_required(): void
    {
        $admin = $this->person('super-admin@example.test');
        $this->as($admin)->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();
        $this->as($admin)->postJson('/api/v1/me/two-step')->assertOk();

        $this->as($admin)->deleteJson('/api/v1/me/two-step')->assertNoContent();
        $this->assertNull($admin->refresh()->two_factor_secret);
    }

    public function test_a_password_sign_in_opens_only_setup_until_it_is_confirmed(): void
    {
        $this->acme->forceFill(['two_step_required' => true])->save();
        $response = $this->withHeader('Origin', 'http://localhost')->postJson('/api/v1/auth/login', ['email' => 'acme.member@example.test', 'password' => 'password']);

        // The password signs them in (they have no second step yet), and says setup comes next ...
        $response->assertOk()->assertJsonPath('data.email', 'acme.member@example.test')->assertJsonPath('data.two_step_setup_required', true);
        // ... and the next request is refused until setup is confirmed.
        $this->withHeader('Origin', 'http://localhost')->getJson("/api/v1/organizations/{$this->acme->uuid}/context")
            ->assertForbidden()->assertJsonPath('code', 'two_step_setup_required');
        $this->withHeader('Origin', 'http://localhost')->getJson('/api/v1/me')->assertOk();
    }

    public function test_a_new_person_accepting_an_invitation_to_a_requiring_organization_is_sent_to_setup(): void
    {
        $this->acme->forceFill(['two_step_required' => true])->save();
        $role = Role::where('organization_id', $this->acme->id)->where('name', 'member')->firstOrFail();
        $token = Str::random(64);
        OrganizationInvitation::query()->create([
            'uuid' => (string) Str::uuid(),
            'organization_id' => $this->acme->id,
            'email' => 'new.member@example.test',
            'role_ids' => [$role->id],
            'token_hash' => hash('sha256', $token),
            'invited_by_user_id' => $this->person('shared.operator@example.test')->id,
            'expires_at' => now()->addDays(7),
        ]);

        $this->withHeader('Origin', 'http://localhost')->postJson("/api/v1/invitations/{$token}/accept", [
            'name' => 'New Member', 'password' => 'safe-password', 'password_confirmation' => 'safe-password',
        ])->assertOk();

        $this->withHeader('Origin', 'http://localhost')->getJson("/api/v1/organizations/{$this->acme->uuid}/context")
            ->assertForbidden()->assertJsonPath('code', 'two_step_setup_required');
        $this->withHeader('Origin', 'http://localhost')->getJson('/api/v1/me/security')->assertOk()->assertJsonPath('data.two_step.required', true);
    }

    public function test_an_agent_token_is_not_affected(): void
    {
        $this->usePassportTestKeys();
        config(['agents.enabled' => true, 'app.frontend_url' => 'https://app.example.test']);
        $this->acme->forceFill(['agent_access_enabled' => true])->save();
        $agent = $this->connectAgent($this->person('shared.operator@example.test'), $this->acme);

        $this->acme->forceFill(['two_step_required' => true])->save();

        $this->mcp($agent['access_token'], 'tools/list')->assertOk();
    }

    public function test_an_application_token_is_not_affected(): void
    {
        $this->acme->forceFill(['two_step_required' => true])->save();
        $site = Site::create(['organization_id' => $this->acme->id, 'name' => 'Hall', 'timezone' => 'UTC']);
        $application = IntegrationApplication::create(['organization_id' => $this->acme->id, 'name' => 'Twin', 'abilities' => ['entities:read'], 'device_uuids' => [], 'entity_uuids' => [$site->uuid]])->fresh();
        $secret = Str::random(40);
        $token = $application->tokens()->create(['name' => 'test', 'token' => hash('sha256', $secret), 'abilities' => ['entities:read'], 'expires_at' => now()->addDay()]);

        $this->withToken($token->id.'|'.$secret)->getJson("/api/integration/v1/organizations/{$this->acme->uuid}/sites")->assertOk();
    }

    public function test_the_agent_consent_page_sends_a_required_person_to_setup_first(): void
    {
        $this->usePassportTestKeys();
        config(['agents.enabled' => true, 'app.frontend_url' => 'https://app.example.test']);
        $this->acme->forceFill(['agent_access_enabled' => true, 'two_step_required' => true])->save();
        $person = $this->person('shared.operator@example.test');
        $client = $this->postJson('/oauth/register', ['client_name' => 'Claude', 'redirect_uris' => ['https://claude.ai/api/mcp/auth_callback']])->assertCreated()->json('client_id');
        $query = http_build_query([
            'response_type' => 'code', 'client_id' => $client, 'redirect_uri' => 'https://claude.ai/api/mcp/auth_callback', 'state' => 's',
            'code_challenge' => str_repeat('a', 43), 'code_challenge_method' => 'S256',
        ]);

        $location = (string) $this->actingAs($person, 'web')->get('/oauth/authorize?'.$query)->assertRedirect()->headers->get('Location');

        $this->assertStringStartsWith('https://app.example.test/account/security/setup?return=', $location);
        parse_str((string) parse_url($location, PHP_URL_QUERY), $params);
        $this->assertStringContainsString('/oauth/authorize?', $params['return']);
    }

    private function person(string $email): User
    {
        return User::where('email', $email)->firstOrFail();
    }

    private ?int $signedIn = null;

    /** Signed in as the person, in a fresh session when the previous request was someone else's. */
    private function as(User $user): static
    {
        if ($this->signedIn !== null && $this->signedIn !== $user->id) {
            $this->flushSession();
            $this->app['auth']->forgetGuards();
        }
        $this->signedIn = $user->id;

        return $this->withHeader('Origin', 'http://localhost')->actingAs($user, 'web');
    }
}
