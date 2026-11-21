<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Audit\Models\Activity;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * A billing account claims one custom domain and proves control of it with a CNAME
 * record (spec 036 US3, FR-011 to FR-016, FR-018).
 */
final class PortalAddressDomainTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase;

    private User $owner;

    private BillingAccount $account;

    private object $dns;

    protected function setUp(): void
    {
        parent::setUp();
        $this->turnAddressesOn();
        $this->dns = $this->fakeDns();
        $this->owner = User::factory()->create();
        $this->account = BillingAccount::factory()->ownedBy($this->owner)->create();
        $this->allow($this->account);
        $this->allow($this->account, AllowanceKind::CustomDomain);
        $this->actingAs($this->owner, 'sanctum');
    }

    public function test_a_claim_shows_the_record_to_add_and_waits_for_it(): void
    {
        $this->travelTo('2026-12-01 10:00:00');
        $response = $this->putJson($this->url('addresses/domain'), ['host' => 'Portal.Example.ORG'])
            ->assertOk()
            ->assertJsonPath('data.kind', 'domain')
            ->assertJsonPath('data.host', 'portal.example.org')
            ->assertJsonPath('data.url', 'https://portal.example.org')
            ->assertJsonPath('data.state', 'waiting_dns')
            ->assertJsonPath('data.main', false)
            ->assertJsonPath('data.record.type', 'CNAME')
            ->assertJsonPath('data.record.name', 'portal.example.org')
            ->assertJsonPath('data.lapses_at', '2026-12-08T10:00:00+00:00');
        $this->assertMatchesRegularExpression('/^c-[0-9a-f]{20}\.example\.com$/', (string) $response->json('data.record.value'));

        // Nothing is served, and no certificate would be asked for, until the record is found.
        $this->assertNull(app(PortalAddresses::class)->resolve('portal.example.org'));
        $this->getJson('/api/internal/portal-addresses/ask?token='.str_repeat('t', 40).'&domain=portal.example.org')->assertNotFound();
        $entry = Activity::query()->where('event', 'portal_address.claimed')->sole();
        $this->assertSame(['host' => 'portal.example.org', 'kind' => 'domain'], $entry->properties->only(['host', 'kind'])->all());

        // Asking again for the same domain keeps the claim and its record.
        $this->putJson($this->url('addresses/domain'), ['host' => 'portal.example.org'])
            ->assertOk()->assertJsonPath('data.record.value', $response->json('data.record.value'));
    }

    public function test_names_that_cannot_be_custom_domains_are_refused(): void
    {
        $this->putJson($this->url('addresses/domain'), ['host' => 'example.org'])
            ->assertUnprocessable()->assertJsonPath('code', 'bare_domain')->assertJsonStructure(['errors' => ['host']]);
        $this->putJson($this->url('addresses/domain'), ['host' => 'acme.example.com'])
            ->assertUnprocessable()->assertJsonPath('code', 'platform_domain');
        $this->putJson($this->url('addresses/domain'), ['host' => 'deep.acme.example.com'])
            ->assertUnprocessable()->assertJsonPath('code', 'platform_domain');
        foreach (['192.0.2.10', 'portal_x.example.org', 'portal..example.org', '-a.example.org'] as $host) {
            $this->putJson($this->url('addresses/domain'), ['host' => $host])
                ->assertUnprocessable()->assertJsonPath('code', 'host_invalid');
        }
        $this->assertSame(0, PortalAddress::query()->count());
    }

    public function test_a_claim_needs_the_allowance_and_the_deployment_switch(): void
    {
        $this->allow($this->account, AllowanceKind::CustomDomain, 0);
        $this->putJson($this->url('addresses/domain'), ['host' => 'portal.example.org'])
            ->assertForbidden()->assertJsonPath('code', 'custom_domain_not_allowed');

        $this->allow($this->account, AllowanceKind::CustomDomain);
        config(['branding.addresses_enabled' => false]);
        $this->putJson($this->url('addresses/domain'), ['host' => 'portal.example.org'])
            ->assertConflict()->assertJsonPath('code', 'addresses_unavailable');
    }

    public function test_the_right_record_activates_and_a_wrong_or_missing_one_does_not(): void
    {
        $address = $this->claim('portal.example.org');
        $target = (string) app(PortalAddresses::class)->record($address)['value'];

        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::WaitingDns, $address->refresh()->state);
        $this->assertNotNull($address->last_checked_at);

        $this->dns->records['portal.example.org'] = ['c-'.str_repeat('0', 20).'.example.com'];
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::WaitingDns, $address->refresh()->state);

        $this->dns->records['portal.example.org'] = [$target];
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Active, $address->refresh()->state);
        $this->assertNotNull($address->activated_at);
        $this->assertNotNull(app(PortalAddresses::class)->resolve('portal.example.org'));
        $this->getJson('/api/internal/portal-addresses/ask?token='.str_repeat('t', 40).'&domain=portal.example.org')->assertOk();
        $entry = Activity::query()->where('event', 'portal_address.activated')->sole();
        $this->assertNull($entry->causer_id);
    }

    public function test_a_request_with_no_record_lapses_after_seven_days_and_frees_the_name(): void
    {
        $address = $this->claim('portal.example.org');

        $this->travel(6)->days();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::WaitingDns, $address->refresh()->state);

        $this->travel(1)->days();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Lapsed, $address->refresh()->state);
        $this->assertSame(1, Activity::query()->where('event', 'portal_address.lapsed')->count());

        // The owner still sees what happened to the request.
        $this->getJson($this->url('branding'))->assertOk()
            ->assertJsonCount(1, 'data.addresses')
            ->assertJsonPath('data.addresses.0.state', 'lapsed');

        // Another account can ask for the name at once: it never served.
        $other = BillingAccount::factory()->create();
        $this->allow($other);
        $this->allow($other, AllowanceKind::CustomDomain);
        $taken = app(PortalAddresses::class)->claimDomain($other, 'portal.example.org', null);
        $this->assertSame(PortalAddressState::WaitingDns, $taken->state);
        $this->getJson($this->url('branding'))->assertOk()->assertJsonCount(0, 'data.addresses');
    }

    public function test_three_failed_checks_mark_it_unreachable_and_one_good_check_restores_it(): void
    {
        $addresses = app(PortalAddresses::class);
        $name = $addresses->claimName($this->account, 'acme', null);
        $address = $this->activeDomain($this->account, 'portal.example.org', $this->dns);
        $target = $this->dns->records['portal.example.org'];
        $this->assertTrue($addresses->mainFor($this->account)?->is($address));

        $this->dns->records = [];
        foreach ([1, 2] as $failed) {
            $this->travel(16)->minutes();
            Artisan::call('branding:check-addresses');
            $this->assertSame(PortalAddressState::Active, $address->refresh()->state);
            $this->assertSame($failed, $address->failed_checks);
        }
        // A serving domain is looked at every 15 minutes, not on every run.
        $this->travel(2)->minutes();
        Artisan::call('branding:check-addresses');
        $this->assertSame(2, $address->refresh()->failed_checks);

        $this->travel(14)->minutes();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Unreachable, $address->refresh()->state);
        $this->assertNotNull($address->unreachable_since);
        // It still serves; only links fall back to the name.
        $this->assertNotNull($addresses->resolve('portal.example.org'));
        $this->assertTrue($addresses->mainFor($this->account)?->is($name));
        $this->getJson($this->url('branding'))->assertOk()
            ->assertJsonPath('data.addresses.0.main', true)
            ->assertJsonPath('data.addresses.1.state', 'unreachable')
            ->assertJsonPath('data.addresses.1.main', false);

        $this->dns->records['portal.example.org'] = $target;
        $this->travel(16)->minutes();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Active, $address->refresh()->state);
        $this->assertNull($address->unreachable_since);
        $this->assertSame(0, $address->failed_checks);
        $this->assertTrue($addresses->mainFor($this->account)?->is($address));
        $this->assertSame(1, Activity::query()->where('event', 'portal_address.unreachable')->count());
        $this->assertSame(1, Activity::query()->where('event', 'portal_address.recovered')->count());
    }

    public function test_check_now_looks_at_once_and_only_once_a_minute(): void
    {
        $address = $this->claim('portal.example.org');
        $this->dns->records['portal.example.org'] = [app(PortalAddresses::class)->record($address)['value']];

        $this->postJson($this->url("addresses/{$address->uuid}/check"))
            ->assertOk()->assertJsonPath('data.state', 'active')->assertJsonPath('data.main', true)->assertJsonPath('data.lapses_at', null);
        $this->postJson($this->url("addresses/{$address->uuid}/check"))
            ->assertStatus(429)->assertJsonPath('code', 'checked_recently')->assertHeader('Retry-After');

        $this->travel(61)->seconds();
        $this->postJson($this->url("addresses/{$address->uuid}/check"))->assertOk();
    }

    public function test_an_account_holds_one_domain_and_a_host_belongs_to_one_account(): void
    {
        $address = $this->activeDomain($this->account, 'portal.example.org', $this->dns);
        $this->putJson($this->url('addresses/domain'), ['host' => 'other.example.org'])
            ->assertConflict()->assertJsonPath('code', 'domain_exists');

        $rival = User::factory()->create();
        $other = BillingAccount::factory()->ownedBy($rival)->create();
        $this->allow($other);
        $this->allow($other, AllowanceKind::CustomDomain);
        $this->actingAs($rival, 'sanctum');
        $otherUrl = "/api/v1/billing-accounts/{$other->uuid}/addresses/domain";
        $this->putJson($otherUrl, ['host' => 'portal.example.org'])->assertConflict()->assertJsonPath('code', 'host_taken');
        // Another account's address is not found, whatever is asked of it.
        $this->postJson("/api/v1/billing-accounts/{$other->uuid}/addresses/{$address->uuid}/check")->assertNotFound();
        $this->deleteJson("/api/v1/billing-accounts/{$other->uuid}/addresses/{$address->uuid}")->assertNotFound();
        $this->putJson($this->url('addresses/domain'), ['host' => 'x.example.org'])->assertNotFound();

        // Removed after it served: held for 30 days, then free. Its own account takes it back at any time.
        $this->actingAs($this->owner, 'sanctum');
        $this->deleteJson($this->url("addresses/{$address->uuid}"))->assertNoContent();
        $this->assertNull(app(PortalAddresses::class)->resolve('portal.example.org'));
        $this->actingAs($rival, 'sanctum');
        $this->putJson($otherUrl, ['host' => 'portal.example.org'])->assertConflict()->assertJsonPath('code', 'host_held');
        $this->actingAs($this->owner, 'sanctum');
        $this->putJson($this->url('addresses/domain'), ['host' => 'portal.example.org'])->assertOk()->assertJsonPath('data.state', 'waiting_dns');
        $this->deleteJson($this->url('addresses/'.PortalAddress::query()->sole()->uuid))->assertNoContent();

        $this->travel(31)->days();
        $this->actingAs($rival, 'sanctum');
        $this->putJson($otherUrl, ['host' => 'portal.example.org'])->assertOk()->assertJsonPath('data.state', 'waiting_dns');
        $this->assertSame($other->id, PortalAddress::query()->where('kind', PortalAddressKind::Domain)->sole()->billing_account_id);
    }

    public function test_a_domain_stops_serving_without_its_allowance_and_staff_claim_without_one(): void
    {
        $this->activeDomain($this->account, 'portal.example.org', $this->dns);
        $this->allow($this->account, AllowanceKind::CustomDomain, 0);
        $this->assertNull(app(PortalAddresses::class)->resolve('portal.example.org'));
        $this->allow($this->account, AllowanceKind::CustomDomain);
        $this->assertNotNull(app(PortalAddresses::class)->resolve('portal.example.org'));

        $plain = BillingAccount::factory()->create();
        $admin = "/api/v1/admin/billing-accounts/{$plain->uuid}/addresses/domain";
        $this->putJson($admin, ['host' => 'view.example.net'])->assertForbidden();
        $this->actingAs(User::factory()->create(['is_super_admin' => true, 'two_factor_confirmed_at' => now(), 'two_factor_secret' => 'x']), 'sanctum');
        $uuid = $this->putJson($admin, ['host' => 'view.example.net'])->assertOk()->assertJsonPath('data.state', 'waiting_dns')->json('data.uuid');
        $this->postJson("/api/v1/admin/billing-accounts/{$plain->uuid}/addresses/{$uuid}/check")->assertOk()->assertJsonPath('data.state', 'waiting_dns');
    }

    public function test_development_stands_a_deeper_local_name_in_for_a_domain(): void
    {
        config(['branding.dns_check' => false]);
        $this->putJson($this->url('addresses/domain'), ['host' => 'acme.example.com'])
            ->assertUnprocessable()->assertJsonPath('code', 'platform_domain');
        $uuid = $this->putJson($this->url('addresses/domain'), ['host' => 'portal.acme.example.com'])
            ->assertOk()->assertJsonPath('data.state', 'waiting_dns')->json('data.uuid');
        $this->postJson($this->url("addresses/{$uuid}/check"))->assertOk()->assertJsonPath('data.state', 'active');
    }

    private function claim(string $host): PortalAddress
    {
        return app(PortalAddresses::class)->claimDomain($this->account, $host, $this->owner);
    }

    private function url(string $path): string
    {
        return "/api/v1/billing-accounts/{$this->account->uuid}/{$path}";
    }
}
