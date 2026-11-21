<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Authentication\Services\KeptSignInCookie;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A custom domain is its own site (spec 036 US3, research R6): the portal calls the API
 * on the domain itself, its cookies belong to that host alone, and a session started
 * there works nowhere else.
 */
final class CustomDomainSessionTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase;

    private const A = 'https://portal.example.org';

    private const B = 'https://view.example.net';

    private const API = 'https://api.example.com';

    private BillingAccount $a;

    private PortalAddress $domain;

    private object $dns;

    private User $ann;

    private User $cy;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ValidateCsrfToken::class);
        Notification::fake();
        $this->turnAddressesOn();
        // As the release sets it: the platform's cookies cover its own domain.
        config(['session.domain' => '.example.com']);
        $this->newRequest();
        $this->dns = $this->fakeDns();

        $this->a = $this->brandedAccount('acme', 'Acme Monitor');
        $b = $this->brandedAccount('borealis', 'Borealis View');
        $this->domain = $this->activeDomain($this->a, 'portal.example.org', $this->dns);
        $this->activeDomain($b, 'view.example.net', $this->dns);
        $a1 = Organization::factory()->create(['billing_account_id' => $this->a->id]);
        $b1 = Organization::factory()->create(['billing_account_id' => $b->id]);

        $this->ann = User::factory()->create(['email' => 'ann@example.test', 'password' => 'password']);
        $this->cy = User::factory()->create(['email' => 'cy@example.test', 'password' => 'password']);
        $this->ann->organizations()->attach($a1);
        $this->cy->organizations()->attach([$a1->id, $b1->id]);
    }

    public function test_the_portal_there_calls_the_api_on_the_domain_itself(): void
    {
        $script = $this->get(self::A.'/api/v1/portal/runtime-config.js')->assertOk()->getContent();
        $config = json_decode(substr((string) $script, strlen('window.__IOT_CONFIG__ = '), -2), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame('', $config['VITE_API_URL']);
        $this->assertSame(self::A, $config['VITE_PORTAL_URL']);
        $this->assertSame(['kind' => 'domain', 'host' => 'portal.example.org', 'state' => 'active'], $config['address']);
        $this->assertSame('Acme Monitor', $config['brand']['product_name']);
        $this->assertStringStartsWith('/api/v1/brand-assets/', $config['brand']['logo'] ?? '/api/v1/brand-assets/');
    }

    public function test_its_session_and_kept_sign_in_cookies_belong_to_the_host_alone(): void
    {
        $response = $this->signIn($this->ann, self::A, remember: true)->assertOk()
            ->assertJsonPath('data.address', ['kind' => 'domain', 'host' => 'portal.example.org']);

        $cookies = collect($response->headers->getCookies())->keyBy(fn ($cookie) => $cookie->getName());
        $this->assertSame([config('session.cookie') => null, KeptSignInCookie::NAME => null], $cookies->map->getDomain()->all());
        $this->on(self::A)->getJson(self::A.'/api/v1/me')->assertOk();

        // On the platform's own address the cookies cover the platform's domain, as before.
        $this->loseSession();
        $platform = $this->onPlatform()
            ->postJson(self::API.'/api/v1/auth/login', ['email' => $this->ann->email, 'password' => 'password', 'remember' => true])->assertOk();
        $cookies = collect($platform->headers->getCookies())->keyBy(fn ($cookie) => $cookie->getName());
        $this->assertSame([config('session.cookie') => '.example.com', KeptSignInCookie::NAME => '.example.com'], $cookies->map->getDomain()->all());
    }

    public function test_a_session_started_there_is_refused_everywhere_else(): void
    {
        $this->signIn($this->cy, self::A)->assertOk();
        $this->on(self::A)->getJson(self::A.'/api/v1/me')->assertOk()->assertJsonCount(1, 'data.organizations');

        // The same session, as if its cookie were copied to the platform's address.
        $this->onPlatform()->getJson(self::API.'/api/v1/me')->assertUnauthorized();
        // It was ended, so it is gone on the domain too.
        $this->on(self::A)->getJson(self::A.'/api/v1/me')->assertUnauthorized();

        // And to another account's domain, where the person is also a member.
        $this->loseSession();
        $this->signIn($this->cy, self::A)->assertOk();
        $this->on(self::B)->getJson(self::B.'/api/v1/me')->assertUnauthorized();
    }

    public function test_a_kept_sign_in_resumes_only_where_it_was_started(): void
    {
        $kept = (string) $this->signIn($this->cy, self::A, remember: true)->assertOk()->getCookie(KeptSignInCookie::NAME)?->getValue();
        $carrying = function (string $origin) use ($kept): static {
            $this->loseSession();

            return ($origin === self::API ? $this->onPlatform() : $this->on($origin))->withCredentials()->withCookie(KeptSignInCookie::NAME, $kept);
        };

        // A browser that lost its session, as after a restart, is signed back in on the domain.
        $carrying(self::A)->getJson(self::A.'/api/v1/me')->assertOk()->assertJsonPath('data.address.host', 'portal.example.org');
        // The same cookie, copied, opens neither the platform's address nor another domain.
        $carrying(self::API)->getJson(self::API.'/api/v1/me')->assertUnauthorized();
        $carrying(self::B)->getJson(self::B.'/api/v1/me')->assertUnauthorized();

        // Nor the domain itself once it was removed and claimed again.
        $addresses = app(PortalAddresses::class);
        $addresses->release($this->domain, null);
        $this->travel(5)->minutes();
        $again = $addresses->claimDomain($this->a, 'portal.example.org', null);
        $this->dns->records['portal.example.org'] = [$addresses->record($again)['value']];
        $addresses->check($again);
        $carrying(self::A)->getJson(self::A.'/api/v1/me')->assertUnauthorized()->assertCookieExpired(KeptSignInCookie::NAME);
    }

    public function test_a_session_from_the_platforms_address_is_refused_there(): void
    {
        $this->onPlatform()
            ->postJson(self::API.'/api/v1/auth/login', ['email' => $this->ann->email, 'password' => 'password'])->assertOk();

        $this->on(self::A)->getJson(self::A.'/api/v1/me')->assertUnauthorized();
    }

    public function test_the_admin_app_agents_and_applications_are_not_served_there(): void
    {
        $staff = User::factory()->create(['is_super_admin' => true]);
        $this->actingAs($staff, 'sanctum');

        $this->on(self::A)->getJson(self::A.'/api/v1/admin/billing-accounts')->assertNotFound();
        $this->on(self::A)->getJson(self::A.'/api/v1/agent-authorizations')->assertNotFound();
        $this->on(self::A)->postJson(self::A.'/mcp')->assertNotFound();
        $this->on(self::A)->get(self::A.'/oauth/authorize')->assertNotFound();
        $this->on(self::A)->get(self::A.'/.well-known/oauth-authorization-server')->assertNotFound();
        // The proxy's certificate question and other internal routes are never an address's.
        $this->getJson(self::A.'/api/internal/portal-addresses/ask?domain=portal.example.org')->assertUnauthorized();
    }

    public function test_removing_the_domain_ends_what_was_signed_in_there(): void
    {
        $addresses = app(PortalAddresses::class);
        $this->signIn($this->ann, self::A)->assertOk();

        $addresses->release($this->domain, null);
        $this->on(self::A)->getJson(self::A.'/api/v1/me')->assertStatus(421)->assertJsonPath('code', 'address_not_in_use');
        $this->assertStringContainsString('"state":"not_in_use"', (string) $this->on(self::A)->get(self::A.'/api/v1/portal/runtime-config.js')->getContent());

        // Claimed and proven again later: the old session does not come back with it.
        $this->travel(5)->minutes();
        $again = $addresses->claimDomain($this->a, 'portal.example.org', null);
        $this->dns->records['portal.example.org'] = [$addresses->record($again)['value']];
        $addresses->check($again);
        $this->on(self::A)->getJson(self::A.'/api/v1/me')->assertUnauthorized();
    }

    public function test_a_suspended_domain_serves_nothing_and_an_unknown_host_from_the_proxy_is_not_in_use(): void
    {
        $this->signIn($this->ann, self::A)->assertOk();
        app(PortalAddresses::class)->suspend($this->domain, User::factory()->create());
        $this->on(self::A)->getJson(self::A.'/api/v1/me')->assertStatus(421);

        // A host nobody claimed, pointed at the deployment: the proxy says it is an address's request.
        $this->on('https://stray.example.net')->getJson('https://stray.example.net/api/v1/me')
            ->assertStatus(421)->assertJsonPath('code', 'address_not_in_use');
        $this->assertStringContainsString('"state":"not_in_use"', (string) $this->on('https://stray.example.net')->get('https://stray.example.net/api/v1/portal/runtime-config.js')->getContent());
    }

    private function on(string $origin): static
    {
        return $this->newRequest()->withHeader('Origin', $origin)->withHeader('X-Portal-Address', '1');
    }

    private function onPlatform(): static
    {
        return $this->newRequest()->withoutHeader('X-Portal-Address')->withHeader('Origin', 'https://app.example.com');
    }

    private function signIn(User $user, string $origin, bool $remember = false): TestResponse
    {
        return $this->on($origin)->postJson($origin.'/api/v1/auth/login', ['email' => $user->email, 'password' => 'password', 'remember' => $remember]);
    }

    /** A new browser: no session, no cookies and no signed-in person. */
    private function loseSession(): void
    {
        Auth::forgetGuards();
        $this->flushSession();
        Cookie::flushQueuedCookies();
        $this->defaultCookies = [];
        $this->flushHeaders();
    }
}
