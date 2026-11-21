<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Laravel\Passkeys\Passkey;
use Tests\Support\PasskeyFixtures;
use Tests\Support\VirtualAuthenticator;
use Tests\TestCase;

/**
 * Passkeys belong to the domain they were made on (spec 036, FR-026), and a required
 * second step is not skipped where a person's passkey cannot answer (FR-027).
 */
final class PasskeyDomainTest extends TestCase
{
    use PasskeyFixtures, PortalAddressFixtures, RefreshDatabase;

    private const DOMAIN = 'https://portal.example.org';

    private const API = 'https://api.example.com';

    private BillingAccount $account;

    private Organization $organization;

    private User $ann;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->turnAddressesOn();
        // The platform's relying party covers its portal and the names under its domain.
        config(['passkeys.relying_party_id' => 'example.com', 'passkeys.allowed_origins' => ['https://app.example.com', 'https://admin.example.com']]);
        $this->newRequest();

        $this->account = $this->brandedAccount('acme', 'Acme Monitor');
        $this->activeDomain($this->account, 'portal.example.org', $this->fakeDns());
        $this->organization = Organization::factory()->create(['billing_account_id' => $this->account->id]);
        $this->ann = User::factory()->create(['email' => 'ann@example.test', 'password' => 'password']);
        $this->ann->organizations()->attach($this->organization);
    }

    public function test_a_passkey_made_on_a_custom_domain_belongs_to_it_and_signs_in_there(): void
    {
        $this->signIn(self::DOMAIN)->assertOk();
        $this->onDomain()->postJson(self::DOMAIN.'/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();

        $options = $this->onDomain()->getJson(self::DOMAIN.'/api/v1/me/passkeys/options')->assertOk()->json('options');
        $this->assertSame('portal.example.org', $options['rp']['id']);
        $authenticator = new VirtualAuthenticator(self::DOMAIN);
        $this->onDomain()->postJson(self::DOMAIN.'/api/v1/me/passkeys', ['name' => 'Office laptop', 'credential' => $authenticator->register($options)])
            ->assertCreated()
            ->assertJsonPath('data.relying_party_id', 'portal.example.org')
            ->assertJsonPath('data.usable_here', true);
        $this->assertSame('portal.example.org', Passkey::query()->sole()->relying_party_id);

        // It signs in on the domain, alone.
        $this->loseSession();
        $options = $this->onDomain()->getJson(self::DOMAIN.'/api/v1/auth/passkeys/options')->assertOk()->json('options');
        $this->assertSame('portal.example.org', $options['rpId']);
        $this->onDomain()->postJson(self::DOMAIN.'/api/v1/auth/passkeys', ['credential' => $authenticator->assert($options)])
            ->assertOk()->assertJsonPath('data.email', $this->ann->email);

        // On the platform's address it is listed with its domain, and does not work.
        $this->loseSession();
        $this->signIn(null)->assertOk();
        $this->onPlatform()->getJson(self::API.'/api/v1/me/security')->assertOk()
            ->assertJsonPath('data.passkeys.items.0.relying_party_id', 'portal.example.org')
            ->assertJsonPath('data.passkeys.items.0.usable_here', false);
        $this->loseSession();
        $options = $this->onPlatform()->getJson(self::API.'/api/v1/auth/passkeys/options')->assertOk()->json('options');
        $this->assertSame('example.com', $options['rpId']);
        $this->onPlatform()->postJson(self::API.'/api/v1/auth/passkeys', ['credential' => $authenticator->assert($options, 'https://app.example.com')])
            ->assertUnprocessable();
        $this->assertGuest('web');
    }

    public function test_a_passkey_from_the_platforms_domain_is_listed_as_elsewhere_and_not_offered_there(): void
    {
        [$authenticator, $passkey] = $this->platformPasskey();
        $this->assertSame('example.com', $passkey->refresh()->relying_party_id);

        $this->signIn(self::DOMAIN)->assertOk();
        $this->onDomain()->getJson(self::DOMAIN.'/api/v1/me/security')->assertOk()
            ->assertJsonPath('data.passkeys.items.0.relying_party_id', 'example.com')
            ->assertJsonPath('data.passkeys.items.0.usable_here', false)
            ->assertJsonPath('data.passkeys.available', true);

        // Confirming with a passkey offers none here, and the same authenticator can be added for this domain.
        $confirm = $this->onDomain()->getJson(self::DOMAIN.'/api/v1/auth/confirm-passkey/options')->assertOk()->json('options');
        $this->assertSame([], $confirm['allowCredentials'] ?? []);
        $this->onDomain()->postJson(self::DOMAIN.'/api/v1/auth/confirm-password', ['password' => 'password'])->assertNoContent();
        $register = $this->onDomain()->getJson(self::DOMAIN.'/api/v1/me/passkeys/options')->assertOk()->json('options');
        $this->assertSame([], $register['excludeCredentials'] ?? []);

        // The platform's passkey cannot sign in on the domain.
        $this->loseSession();
        $options = $this->onDomain()->getJson(self::DOMAIN.'/api/v1/auth/passkeys/options')->assertOk()->json('options');
        $this->onDomain()->postJson(self::DOMAIN.'/api/v1/auth/passkeys', ['credential' => $authenticator->assert($options, self::DOMAIN)])
            ->assertUnprocessable();
        $this->assertGuest('web');
    }

    public function test_a_platform_passkey_works_on_a_name_under_the_platforms_domain(): void
    {
        [$authenticator] = $this->platformPasskey();

        $name = 'https://acme.example.com';
        $options = $this->newRequest()->withHeader('Origin', $name)->getJson(self::API.'/api/v1/auth/passkeys/options')->assertOk()->json('options');
        $this->assertSame('example.com', $options['rpId']);
        $this->newRequest()->withHeader('Origin', $name)->postJson(self::API.'/api/v1/auth/passkeys', ['credential' => $authenticator->assert($options, $name)])
            ->assertOk()->assertJsonPath('data.address.kind', 'name');
    }

    public function test_a_required_second_step_is_not_skipped_where_the_passkey_cannot_answer(): void
    {
        $this->platformPasskey();
        $this->organization->forceFill(['two_step_required' => true])->save();

        // On the platform's address the passkey is the second step.
        $this->signIn(null)->assertStatus(202)->assertJsonPath('methods', ['passkey']);

        // On the custom domain it cannot answer: the password alone does not get in.
        $this->loseSession();
        $this->signIn(self::DOMAIN)->assertForbidden()->assertJsonPath('code', 'second_step_elsewhere');
        $this->assertGuest('web');
        $this->onDomain()->getJson(self::DOMAIN.'/api/v1/me')->assertUnauthorized();

        // A wrong password there answers as it does anywhere.
        $this->onDomain()->postJson(self::DOMAIN.'/api/v1/auth/login', ['email' => $this->ann->email, 'password' => 'wrong-password'])
            ->assertUnprocessable()->assertJsonMissingPath('code');
    }

    /**
     * @return array{0: VirtualAuthenticator, 1: Passkey}
     */
    private function platformPasskey(): array
    {
        $this->newRequest();
        config(['passkeys.allowed_origins' => ['https://app.example.com', 'http://localhost:5173']]);
        $made = $this->givePasskey($this->ann);
        $this->newRequest();

        return $made;
    }

    private function onDomain(): static
    {
        return $this->newRequest()->withHeader('Origin', self::DOMAIN)->withHeader('X-Portal-Address', '1');
    }

    private function onPlatform(): static
    {
        return $this->newRequest()->withoutHeader('X-Portal-Address')->withHeader('Origin', 'https://app.example.com');
    }

    private function signIn(?string $domain): TestResponse
    {
        return ($domain === null ? $this->onPlatform() : $this->onDomain())
            ->postJson(($domain ?? self::API).'/api/v1/auth/login', ['email' => $this->ann->email, 'password' => 'password']);
    }

    private function loseSession(): void
    {
        $this->flushSession();
        $this->defaultCookies = [];
        $this->newRequest();
    }
}
