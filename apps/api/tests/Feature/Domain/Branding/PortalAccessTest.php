<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Administration\Models\OrganizationInvitation;
use App\Domain\Authorization\Models\Role;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\TwoStepFixtures;
use Tests\TestCase;

/**
 * Who gets in at a billing account's address, and what they reach there (spec 036 US4,
 * FR-020 to FR-024; constitution III). Accounts A and B, and people in one, the other
 * and both.
 */
final class PortalAccessTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase, TwoStepFixtures;

    private const A = 'https://acme.example.com';

    private const PLATFORM = 'https://app.example.com';

    private BillingAccount $a;

    private Organization $a1;

    private Organization $a2;

    private Organization $b1;

    private User $ann;

    private User $bo;

    private User $cy;

    private User $staff;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->turnAddressesOn();

        $this->a = $this->brandedAccount('acme', 'Acme Monitor');
        $b = $this->brandedAccount('borealis', 'Borealis View');
        $this->a1 = Organization::factory()->create(['name' => 'A One', 'billing_account_id' => $this->a->id]);
        $this->a2 = Organization::factory()->create(['name' => 'A Two', 'billing_account_id' => $this->a->id]);
        $this->b1 = Organization::factory()->create(['name' => 'B One', 'billing_account_id' => $b->id]);

        $this->ann = User::factory()->create(['email' => 'ann@example.test', 'password' => 'password']);
        $this->bo = User::factory()->create(['email' => 'bo@example.test', 'password' => 'password']);
        $this->cy = User::factory()->create(['email' => 'cy@example.test', 'password' => 'password']);
        $this->staff = User::factory()->create(['email' => 'staff@example.test', 'password' => 'password', 'is_super_admin' => true]);
        $this->ann->organizations()->attach($this->a1);
        $this->bo->organizations()->attach($this->b1);
        $this->cy->organizations()->attach([$this->a1->id, $this->b1->id]);
    }

    public function test_a_member_of_the_account_signs_in_at_its_address(): void
    {
        $this->signIn($this->ann, self::A)->assertOk()
            ->assertJsonPath('data.organizations.0.uuid', $this->a1->uuid)
            ->assertJsonPath('data.address', ['kind' => 'name', 'host' => 'acme.example.com']);

        $this->at(self::A)->getJson('/api/v1/me')->assertOk()->assertJsonCount(1, 'data.organizations');
        // The platform's own address says nothing of an address.
        $this->at(self::PLATFORM)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.address', null);
    }

    public function test_a_member_of_two_accounts_reaches_only_the_addresss_account(): void
    {
        $this->signIn($this->cy, self::A)->assertOk()
            ->assertJsonCount(1, 'data.organizations')
            ->assertJsonPath('data.organizations.0.uuid', $this->a1->uuid);

        $this->at(self::A)->deleteJson("/api/v1/organizations/{$this->b1->uuid}/logo")
            ->assertNotFound()->assertJsonPath('code', 'not_available_here');
        // Their own organization there answers as it always did: found, and theirs.
        $this->at(self::A)->deleteJson("/api/v1/organizations/{$this->a1->uuid}/logo")->assertForbidden()->assertJsonMissingPath('code');

        // The same session on the platform's address reaches both.
        $this->at(self::PLATFORM)->getJson('/api/v1/me')->assertOk()->assertJsonCount(2, 'data.organizations');
        $this->at(self::PLATFORM)->deleteJson("/api/v1/organizations/{$this->b1->uuid}/logo")->assertForbidden()->assertJsonMissingPath('code');
    }

    public function test_a_person_outside_the_account_is_refused_only_after_a_right_password(): void
    {
        $this->signIn($this->bo, self::A)->assertForbidden()
            ->assertExactJson(['code' => 'not_available_here', 'message' => 'This account cannot sign in at this address.']);
        $this->assertGuest('web');
        $this->at(self::A)->getJson('/api/v1/me')->assertUnauthorized();

        // A wrong password, and an address nobody has, answer as they do anywhere.
        $wrong = $this->at(self::A)->postJson('/api/v1/auth/login', ['email' => $this->bo->email, 'password' => 'wrong-password'])->assertUnprocessable();
        $unknown = $this->at(self::A)->postJson('/api/v1/auth/login', ['email' => 'nobody@example.test', 'password' => 'wrong-password'])->assertUnprocessable();
        $this->assertSame($wrong->json(), $unknown->json());

        // On their own account's address, and on the platform's, they sign in.
        $this->signIn($this->bo, 'https://borealis.example.com')->assertOk();
        $this->loseSession();
        $this->signIn($this->bo, self::PLATFORM)->assertOk()->assertJsonPath('data.address', null);
    }

    public function test_the_refusal_comes_after_the_second_step(): void
    {
        [$secret] = $this->turnOnTwoStep($this->bo);

        // The password step tells nothing: the same 202 as for a person who may sign in.
        $this->signIn($this->bo, self::A)->assertStatus(202)->assertJsonPath('two_step_required', true);
        $this->at(self::A)->postJson('/api/v1/auth/two-step', ['code' => $this->totp($secret)])
            ->assertForbidden()->assertJsonPath('code', 'not_available_here');
        $this->assertGuest('web');
    }

    public function test_a_super_administrator_reaches_only_the_accounts_organizations_there(): void
    {
        // Staff must have two-step on to reach anything (spec 034).
        [$secret] = $this->turnOnTwoStep($this->staff);
        $this->signIn($this->staff, self::A)->assertStatus(202);
        $this->at(self::A)->postJson('/api/v1/auth/two-step', ['code' => $this->totp($secret)])->assertOk()
            ->assertJsonPath('data.organizations', fn (array $organizations): bool => collect($organizations)->pluck('uuid')->sort()->values()->all() === collect([$this->a1->uuid, $this->a2->uuid])->sort()->values()->all());

        $this->at(self::A)->deleteJson("/api/v1/organizations/{$this->b1->uuid}/logo")->assertNotFound()->assertJsonPath('code', 'not_available_here');
        $this->at(self::A)->deleteJson("/api/v1/organizations/{$this->a2->uuid}/logo")->assertOk();
        $this->at(self::PLATFORM)->deleteJson("/api/v1/organizations/{$this->b1->uuid}/logo")->assertOk();
    }

    public function test_losing_the_last_organization_under_the_account_closes_the_address_on_the_next_request(): void
    {
        $this->signIn($this->cy, self::A)->assertOk();
        $this->cy->organizations()->detach($this->a1);

        $this->at(self::A)->getJson('/api/v1/me')->assertForbidden()->assertJsonPath('code', 'not_available_here');
        $this->at(self::A)->getJson('/api/v1/me/security')->assertForbidden()->assertJsonPath('code', 'not_available_here');
        // The session is shared with the platform's address, where they still belong.
        $this->at(self::PLATFORM)->getJson('/api/v1/me')->assertOk();
        // Signing out still works from the address.
        $this->at(self::A)->postJson('/api/v1/auth/logout')->assertOk();
    }

    public function test_a_session_on_the_addresss_own_host_ends_when_access_does(): void
    {
        // As in development, where the name serves the API itself.
        config(['branding.same_origin_names' => true]);
        $this->postJson('https://acme.example.com/api/v1/auth/login', ['email' => $this->ann->email, 'password' => 'password'], ['Origin' => self::A])->assertOk();
        $this->getJson('https://acme.example.com/api/v1/me', ['Origin' => self::A])->assertOk()->assertJsonPath('data.address.host', 'acme.example.com');

        $this->ann->organizations()->detach($this->a1);
        $this->getJson('https://acme.example.com/api/v1/me', ['Origin' => self::A])->assertForbidden()->assertJsonPath('code', 'not_available_here');
        $this->assertGuest('web');
        $this->getJson('https://acme.example.com/api/v1/me', ['Origin' => self::A])->assertUnauthorized();
    }

    public function test_a_name_does_not_serve_the_api_on_its_own_host_outside_development(): void
    {
        $this->getJson('https://acme.example.com/api/v1/me')->assertNotFound();
        $this->get('https://acme.example.com/api/v1/portal/runtime-config.js')->assertOk();
    }

    public function test_nobody_signs_up_at_an_address(): void
    {
        app('db')->table('sign_up_settings')->updateOrInsert(['id' => 1], ['open' => true, 'free_beta' => true, 'notify_push' => false, 'notify_email' => false, 'daily_limit' => 100, 'revision' => 1]);

        $this->at(self::PLATFORM)->getJson('/api/v1/sign-up')->assertOk()->assertJsonPath('open', true);
        $this->at(self::A)->getJson('/api/v1/sign-up')->assertOk()->assertJsonPath('open', false)->assertJsonPath('form_token', null);
        $this->at(self::A)->postJson('/api/v1/sign-up', [
            'name' => 'New Person', 'email' => 'new@example.test', 'password' => 'a-long-safe-password', 'password_confirmation' => 'a-long-safe-password', 'organization_name' => 'New Org',
        ])->assertForbidden()->assertJsonPath('code', 'sign_up_closed');
    }

    public function test_an_invitation_is_accepted_only_at_an_address_of_its_organizations_account(): void
    {
        $invite = function (Organization $organization, string $email): string {
            $token = Str::random(64);
            $role = Role::create(['name' => 'viewer-'.Str::random(6), 'display_name' => 'Viewer', 'guard_name' => 'web', 'organization_id' => $organization->id, 'is_default' => false]);
            OrganizationInvitation::query()->create([
                'uuid' => (string) Str::uuid(), 'organization_id' => $organization->id, 'email' => $email,
                'role_ids' => [$role->id], 'token_hash' => hash('sha256', $token), 'expires_at' => now()->addDays(7),
            ]);

            return $token;
        };
        $accept = ['name' => 'New Person', 'password' => 'a-long-safe-password', 'password_confirmation' => 'a-long-safe-password'];

        $theirs = $invite($this->b1, 'dee@example.test');
        $this->at(self::A)->postJson("/api/v1/invitations/{$theirs}/accept", $accept)->assertForbidden()->assertJsonPath('code', 'not_available_here');
        $this->assertGuest('web');
        $this->assertSame(0, User::query()->where('email', 'dee@example.test')->count());

        $ours = $invite($this->a1, 'eve@example.test');
        $this->at(self::A)->postJson("/api/v1/invitations/{$ours}/accept", $accept)->assertOk()->assertJsonPath('data.organizations.0.uuid', $this->a1->uuid);
    }

    public function test_a_host_that_is_not_an_address_that_serves_is_refused(): void
    {
        $login = ['email' => $this->ann->email, 'password' => 'password'];
        $this->at('https://nobody.example.com')->postJson('/api/v1/auth/login', $login)->assertStatus(421)->assertJsonPath('code', 'address_not_in_use');

        app(PortalAddresses::class)->suspend($this->addressOf($this->a), $this->staff);
        $this->at(self::A)->postJson('/api/v1/auth/login', $login)->assertStatus(421)->assertJsonPath('code', 'address_not_in_use');
        app(PortalAddresses::class)->restore($this->addressOf($this->a), $this->staff);
        $this->at(self::A)->postJson('/api/v1/auth/login', $login)->assertOk();
        $this->loseSession();

        // Without the allowance the address is as good as suspended.
        $this->allow($this->a, AllowanceKind::Branding, 0);
        $this->at(self::A)->postJson('/api/v1/auth/login', $login)->assertStatus(421);

        // The platform's own hosts, and hosts outside its domain, are never refused.
        $this->at(self::PLATFORM)->postJson('/api/v1/auth/login', $login)->assertOk();
        $this->at('https://admin.example.com')->getJson('/api/v1/me')->assertOk();
        $this->at('https://elsewhere.example.org')->getJson('/api/v1/sign-up')->assertOk();
    }

    public function test_with_addresses_off_every_answer_is_as_before(): void
    {
        config(['branding.addresses_enabled' => false]);

        // The addresses that were claimed mean nothing (FR-040): their origin is one more
        // origin the deployment does not know, and nothing is narrowed or refused for it.
        app('db')->table('sign_up_settings')->updateOrInsert(['id' => 1], ['open' => true, 'free_beta' => true, 'notify_push' => false, 'notify_email' => false, 'daily_limit' => 100, 'revision' => 1]);
        $this->at(self::A)->getJson('/api/v1/sign-up')->assertOk()->assertJsonPath('open', true);
        $this->at('https://nobody.example.com')->getJson('/api/v1/sign-up')->assertOk();

        $this->signIn($this->cy, self::PLATFORM)->assertOk()->assertJsonPath('data.address', null)->assertJsonCount(2, 'data.organizations');
    }

    public function test_address_origins_pass_the_cross_origin_check_only_while_addresses_are_on(): void
    {
        $settings = function (?string $switch): array {
            $_SERVER['PORTAL_ADDRESSES'] = $switch;
            $_SERVER['PORTAL_ADDRESSES_DOMAIN'] = 'Example.com.';
            try {
                return require config_path('cors.php');
            } finally {
                unset($_SERVER['PORTAL_ADDRESSES'], $_SERVER['PORTAL_ADDRESSES_DOMAIN']);
            }
        };
        $this->assertSame([], $settings('off')['allowed_origins_patterns']);
        [$pattern] = $settings('on')['allowed_origins_patterns'];
        foreach (['https://acme.example.com' => 1, 'http://acme.example.com:5173' => 1, 'https://a.b.example.com' => 0, 'https://example.com' => 0, 'https://acme.example.com.evil.test' => 0, 'https://acmeexample.com' => 0] as $origin => $allowed) {
            $this->assertSame($allowed, preg_match($pattern, $origin), $origin);
        }

        config(['cors.allowed_origins_patterns' => [$pattern]]);
        $this->withHeaders(['Origin' => self::A, 'Access-Control-Request-Method' => 'POST'])->options('/api/v1/auth/login')
            ->assertHeader('Access-Control-Allow-Origin', self::A)
            ->assertHeader('Access-Control-Allow-Credentials', 'true');
    }

    private function at(string $origin): static
    {
        return $this->withHeader('Origin', $origin);
    }

    private function signIn(User $user, string $origin): TestResponse
    {
        return $this->at($origin)->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password']);
    }

    /** A new browser: no session and no signed-in person. */
    private function loseSession(): void
    {
        $this->flushSession();
        $this->app['auth']->forgetGuards();
    }
}
