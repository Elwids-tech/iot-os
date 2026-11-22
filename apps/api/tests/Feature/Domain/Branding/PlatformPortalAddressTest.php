<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Audit\Models\Activity;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Platform staff see every portal address, suspend and restore one (spec 036 US6,
 * FR-017, FR-036, FR-037). Account A holds a name and a custom domain, account B a name.
 */
final class PlatformPortalAddressTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase;

    private const DOMAIN = 'https://portal.example.org';

    /** Absolute: a path alone would be asked of whichever host the test's last request named. */
    private const API = 'https://api.example.com';

    private const LIST = self::API.'/api/v1/admin/portal-addresses';

    private BillingAccount $a;

    private BillingAccount $b;

    private PortalAddress $name;

    private PortalAddress $domain;

    private object $dns;

    private User $staff;

    private User $owner;

    private User $member;

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

        $this->a = $this->brandedAccount('acme', 'Acme Monitor', ['name' => 'Acme Water']);
        $this->b = $this->brandedAccount('borealis', 'Borealis View', ['name' => 'Borealis Power']);
        $this->name = $this->addressOf($this->a);
        $this->domain = $this->activeDomain($this->a, 'portal.example.org', $this->dns);

        $this->staff = User::factory()->create(['is_super_admin' => true]);
        $this->owner = User::factory()->create();
        $this->a->owners()->attach($this->owner->id, ['created_at' => now()]);
        $this->member = User::factory()->create(['email' => 'ann@example.test', 'password' => 'password']);
        $this->member->organizations()->attach(Organization::factory()->create(['billing_account_id' => $this->a->id]));
    }

    public function test_the_list_and_its_actions_are_refused_to_everyone_but_platform_staff(): void
    {
        $this->getJson(self::LIST)->assertUnauthorized();

        foreach ([$this->member, $this->owner] as $person) {
            $this->actingAs($person, 'sanctum');
            $this->getJson(self::LIST)->assertForbidden();
            $this->postJson(self::LIST."/{$this->name->uuid}/suspend")->assertForbidden();
            $this->postJson(self::LIST."/{$this->name->uuid}/restore")->assertForbidden();
        }
        $this->assertSame(PortalAddressState::Active, $this->name->refresh()->state);

        $this->actingAs($this->staff, 'sanctum')->getJson(self::LIST)->assertOk();
    }

    public function test_staff_see_every_address_with_its_account_and_narrow_the_list(): void
    {
        $this->actingAs($this->staff, 'sanctum');
        // Released addresses are history, not something to act on.
        $gone = $this->brandedAccount('gone', 'Gone Monitor');
        app(PortalAddresses::class)->release($this->addressOf($gone), null);

        $this->getJson(self::LIST)->assertOk()
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('data.*.host', ['acme.example.com', 'borealis.example.com', 'portal.example.org'])
            ->assertJsonPath('data.0.kind', 'name')
            ->assertJsonPath('data.0.state', 'active')
            ->assertJsonPath('data.0.serving', true)
            ->assertJsonPath('data.0.billing_account', ['uuid' => $this->a->uuid, 'name' => 'Acme Water'])
            ->assertJsonPath('data.2.kind', 'domain')
            ->assertJsonPath('data.2.main', true)
            ->assertJsonPath('data.2.billing_account.uuid', $this->a->uuid);

        $this->postJson(self::LIST."/{$this->domain->uuid}/suspend")->assertOk();
        $this->getJson(self::LIST.'?state=suspended')->assertOk()->assertJsonPath('data.*.host', ['portal.example.org']);
        $this->getJson(self::LIST.'?state=active')->assertOk()->assertJsonPath('data.*.host', ['acme.example.com', 'borealis.example.com']);
        $this->getJson(self::LIST.'?state=released')->assertUnprocessable();

        // By host, or by the billing account's name.
        $this->getJson(self::LIST.'?search=BOREALIS.example')->assertOk()->assertJsonPath('data.*.host', ['borealis.example.com']);
        $this->getJson(self::LIST.'?search=acme+water')->assertOk()->assertJsonPath('data.*.host', ['acme.example.com', 'portal.example.org']);
        $this->getJson(self::LIST.'?search=acme+water&state=suspended')->assertOk()->assertJsonPath('data.*.host', ['portal.example.org']);
        $this->getJson(self::LIST.'?search=nobody')->assertOk()->assertJsonPath('meta.total', 0);

        $this->getJson(self::LIST.'?per_page=2&page=2')->assertOk()
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('data.*.host', ['portal.example.org']);
    }

    public function test_a_suspended_name_stops_at_once_and_its_owner_cannot_bring_it_back(): void
    {
        $this->actingAs($this->staff, 'sanctum')
            ->postJson(self::LIST."/{$this->name->uuid}/suspend")->assertOk()
            ->assertJsonPath('data.state', 'suspended')
            ->assertJsonPath('data.serving', false)
            ->assertJsonPath('data.main', false)
            ->assertJsonPath('data.suspended_by_user_id', $this->staff->id)
            ->assertJsonPath('data.billing_account.uuid', $this->a->uuid);
        $this->assertNotNull($this->name->refresh()->suspended_at);

        // No waiting: the remembered answer for the host is dropped with the change (FR-017).
        $this->ask('acme.example.com')->assertNotFound();
        $this->assertSame(['state' => 'not_in_use'], $this->bootstrap('acme.example.com')['address']);
        $this->assertArrayNotHasKey('brand', $this->bootstrap('acme.example.com'));
        // The account's other address and other accounts are untouched.
        $this->ask('portal.example.org')->assertOk();
        $this->ask('borealis.example.com')->assertOk();

        // Suspending again changes nothing and is recorded once.
        $this->postJson(self::LIST."/{$this->name->uuid}/suspend")->assertOk()->assertJsonPath('data.state', 'suspended');

        $this->actingAs($this->owner, 'sanctum');
        $owned = self::API."/api/v1/billing-accounts/{$this->a->uuid}";
        $this->getJson("{$owned}/branding")->assertOk()->assertJsonPath('data.addresses.0.state', 'suspended');
        $this->deleteJson("{$owned}/addresses/{$this->name->uuid}")->assertStatus(409)->assertJsonPath('code', 'suspended');
        $this->putJson("{$owned}/addresses/name", ['name' => 'acme-two'])->assertStatus(409)->assertJsonPath('code', 'suspended');
        $this->postJson("{$owned}/addresses/{$this->name->uuid}/check")->assertOk()->assertJsonPath('data.state', 'suspended');
        $this->postJson(self::LIST."/{$this->name->uuid}/restore")->assertForbidden();
        $this->ask('acme.example.com')->assertNotFound();

        $this->actingAs($this->staff, 'sanctum')
            ->postJson(self::LIST."/{$this->name->uuid}/restore")->assertOk()
            ->assertJsonPath('data.state', 'active')
            ->assertJsonPath('data.serving', true)
            ->assertJsonPath('data.suspended_at', null)
            ->assertJsonPath('data.suspended_by_user_id', null);
        $this->ask('acme.example.com')->assertOk();
        $this->assertSame('active', $this->bootstrap('acme.example.com')['address']['state']);
        $this->assertSame('Acme Monitor', $this->bootstrap('acme.example.com')['brand']['product_name']);

        $events = Activity::query()->whereIn('event', ['portal_address.suspended', 'portal_address.restored'])->orderBy('id')->get();
        $this->assertSame(['portal_address.suspended', 'portal_address.restored'], $events->pluck('event')->all());
        $this->assertSame([$this->staff->id, $this->staff->id], $events->pluck('causer_id')->all());
        $this->assertSame('acme.example.com', $events[0]->properties['host']);
    }

    public function test_suspending_a_custom_domain_ends_what_was_signed_in_there(): void
    {
        $this->signInOnDomain()->assertOk();
        $this->onDomain()->getJson(self::DOMAIN.'/api/v1/me')->assertOk();

        $this->suspend($this->domain)->assertOk()->assertJsonPath('data.state', 'suspended');
        $this->onDomain()->getJson(self::DOMAIN.'/api/v1/me')->assertStatus(421)->assertJsonPath('code', 'address_not_in_use');
        $this->ask('portal.example.org')->assertNotFound();
        $this->assertSame(['state' => 'not_in_use'], $this->bootstrap('portal.example.org')['address']);

        // Restored with its record still in place: it serves at once, as a new activation,
        // so the session from before the suspension does not come back with it.
        $this->travel(5)->minutes();
        $this->restore($this->domain)->assertOk()
            ->assertJsonPath('data.state', 'active')
            ->assertJsonPath('data.serving', true)
            ->assertJsonPath('data.main', true);
        $this->ask('portal.example.org')->assertOk();
        $this->onDomain()->getJson(self::DOMAIN.'/api/v1/me')->assertUnauthorized();
        $this->signInOnDomain()->assertOk();
    }

    public function test_restoring_a_custom_domain_checks_its_record_again(): void
    {
        // The record went away while the domain was suspended: it waits again, with a new week.
        $this->suspend($this->domain)->assertOk();
        $this->dns->records = [];
        $this->travel(10)->days();
        $this->restore($this->domain)->assertOk()
            ->assertJsonPath('data.state', 'waiting_dns')
            ->assertJsonPath('data.serving', false)
            ->assertJsonPath('data.lapses_at', now()->addDays(7)->toIso8601String());
        $this->ask('portal.example.org')->assertNotFound();

        // A domain suspended while it waited goes back to waiting.
        $this->suspend($this->domain)->assertOk()->assertJsonPath('data.state', 'suspended');
        $this->restore($this->domain)->assertOk()->assertJsonPath('data.state', 'waiting_dns');

        // Restoring what is not suspended changes nothing.
        $this->restore($this->name)->assertOk()->assertJsonPath('data.state', 'active');
        $this->assertSame(2, Activity::query()->where('event', 'portal_address.restored')->count());
    }

    public function test_an_address_that_is_released_or_unknown_cannot_be_suspended_or_restored(): void
    {
        app(PortalAddresses::class)->release($this->name, null);

        $this->suspend($this->name)->assertNotFound();
        $this->restore($this->name)->assertNotFound();
        $this->postJson(self::LIST.'/0199a1c2-0000-7000-8000-000000000000/suspend')->assertNotFound();
        $this->assertSame(PortalAddressState::Released, $this->name->refresh()->state);
    }

    public function test_withdrawing_branding_stops_every_address_without_changing_its_state(): void
    {
        $this->actingAs($this->staff, 'sanctum');
        $allowance = self::API."/api/v1/admin/billing-accounts/{$this->a->uuid}/allowances/branding";

        $this->putJson($allowance, ['value' => 0, 'note' => 'Paused'])->assertOk();
        // Within the time a host's answer is remembered (FR-017).
        $this->travel(PortalAddresses::CACHE_SECONDS + 1)->seconds();
        $this->ask('acme.example.com')->assertNotFound();
        $this->ask('portal.example.org')->assertNotFound();
        $this->assertSame(['state' => 'not_in_use'], $this->bootstrap('acme.example.com')['address']);
        $this->assertSame(['state' => 'not_in_use'], $this->bootstrap('portal.example.org')['address']);
        $this->ask('borealis.example.com')->assertOk();

        // The states are as they were; the list says they do not serve.
        $this->actingAs($this->staff, 'sanctum')->getJson(self::LIST.'?search=acme+water')->assertOk()
            ->assertJsonPath('data.*.state', ['active', 'active'])
            ->assertJsonPath('data.*.serving', [false, false])
            ->assertJsonPath('data.*.main', [false, false]);
        $this->assertSame(0, Activity::query()->whereIn('event', ['portal_address.suspended', 'portal_address.released'])->count());

        $this->putJson($allowance, ['value' => 1, 'note' => 'Back'])->assertOk();
        $this->travel(PortalAddresses::CACHE_SECONDS + 1)->seconds();
        $this->ask('acme.example.com')->assertOk();
        $this->ask('portal.example.org')->assertOk();
        $this->assertSame('Acme Monitor', $this->bootstrap('acme.example.com')['brand']['product_name']);
        $this->actingAs($this->staff, 'sanctum')->getJson(self::LIST.'?search=acme+water')->assertOk()
            ->assertJsonPath('data.*.serving', [true, true]);
    }

    private function suspend(PortalAddress $address): TestResponse
    {
        return $this->asStaff()->postJson(self::LIST."/{$address->uuid}/suspend");
    }

    private function restore(PortalAddress $address): TestResponse
    {
        return $this->asStaff()->postJson(self::LIST."/{$address->uuid}/restore");
    }

    /** Staff call the platform's API with a token, so the browser session under test is left alone. */
    private function asStaff(): static
    {
        return $this->newRequest()->withoutHeader('X-Portal-Address')->withoutHeader('Origin')->actingAs($this->staff, 'sanctum');
    }

    private function onDomain(): static
    {
        return $this->newRequest()->withHeader('Origin', self::DOMAIN)->withHeader('X-Portal-Address', '1');
    }

    private function signInOnDomain(): TestResponse
    {
        return $this->onDomain()->postJson(self::DOMAIN.'/api/v1/auth/login', ['email' => $this->member->email, 'password' => 'password']);
    }

    /** What the proxy is told before it asks for a certificate for the host. */
    private function ask(string $host): TestResponse
    {
        return $this->getJson(self::API.'/api/internal/portal-addresses/ask?token='.str_repeat('t', 40).'&domain='.$host);
    }

    /**
     * What the portal reads before it starts on the host.
     *
     * @return array<string, mixed>
     */
    private function bootstrap(string $host): array
    {
        $body = (string) $this->get("https://{$host}/api/v1/portal/runtime-config.js")->assertOk()->getContent();

        return json_decode(substr($body, strlen('window.__IOT_CONFIG__ = '), -2), true, flags: JSON_THROW_ON_ERROR);
    }
}
