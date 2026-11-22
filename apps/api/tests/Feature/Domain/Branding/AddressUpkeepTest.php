<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Audit\Models\Activity;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Jobs\DeliverBillingEmail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Mail\PortalAddressMail;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * What the scheduled check does beyond reading DNS (spec 036, T102, T105, T106): it
 * gives up an address 30 days after its allowance went, tells the owners when a domain
 * lapses or loses its record, and the release check can ask for a name that serves.
 */
final class AddressUpkeepTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase;

    private User $owner;

    private BillingAccount $account;

    private object $dns;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->turnAddressesOn();
        $this->dns = $this->fakeDns();
        $this->travelTo('2026-12-01 10:00:00');
        $this->owner = User::factory()->create();
        $this->account = BillingAccount::factory()->ownedBy($this->owner)->create(['name' => 'Acme']);
        $this->allow($this->account);
        $this->allow($this->account, AllowanceKind::CustomDomain);
        $this->actingAs($this->owner, 'sanctum');
    }

    public function test_an_address_is_given_up_thirty_days_after_its_allowance_went(): void
    {
        $addresses = app(PortalAddresses::class);
        $name = $addresses->claimName($this->account, 'acme', null);
        Artisan::call('branding:check-addresses');
        $this->assertNull($name->refresh()->allowance_off_since);

        $this->allow($this->account, AllowanceKind::Branding, 0);
        Artisan::call('branding:check-addresses');
        $this->assertSame('2026-12-01T10:00:00+00:00', $name->refresh()->allowance_off_since?->toIso8601String());
        $this->getJson("/api/v1/billing-accounts/{$this->account->uuid}/branding")->assertOk()
            ->assertJsonPath('data.addresses.0.state', 'active')
            ->assertJsonPath('data.addresses.0.releases_at', '2026-12-31T10:00:00+00:00');

        $this->travel(29)->days();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Active, $name->refresh()->state);
        Queue::assertNothingPushed();

        $this->travel(1)->days();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Released, $name->refresh()->state);
        $entry = Activity::query()->where('event', 'portal_address.released')->sole();
        $this->assertNull($entry->causer_id);
        $this->assertSame('allowance_withdrawn', $entry->properties['reason']);
        Queue::assertPushed(DeliverBillingEmail::class, 1);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->userId === $this->owner->id
            && $job->mail instanceof PortalAddressMail && $job->mail->event === PortalAddressMail::RELEASED && $job->mail->host === 'acme.example.com');

        // Held like any released name: another account cannot take it for 30 more days.
        $other = BillingAccount::factory()->create();
        $this->allow($other);
        $this->putJsonAs($other, 'acme')->assertConflict()->assertJsonPath('code', 'name_taken');
    }

    public function test_an_allowance_that_returns_in_time_keeps_the_address_and_starts_the_count_again(): void
    {
        $addresses = app(PortalAddresses::class);
        $name = $addresses->claimName($this->account, 'acme', null);
        $this->allow($this->account, AllowanceKind::Branding, 0);
        Artisan::call('branding:check-addresses');

        $this->travel(20)->days();
        $this->allow($this->account);
        Artisan::call('branding:check-addresses');
        $this->assertNull($name->refresh()->allowance_off_since);
        $this->getJson("/api/v1/billing-accounts/{$this->account->uuid}/branding")->assertOk()
            ->assertJsonPath('data.addresses.0.releases_at', null);

        $this->allow($this->account, AllowanceKind::Branding, 0);
        Artisan::call('branding:check-addresses');
        $this->travel(20)->days();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Active, $name->refresh()->state);
    }

    public function test_without_custom_domain_only_the_domain_is_given_up(): void
    {
        $addresses = app(PortalAddresses::class);
        $name = $addresses->claimName($this->account, 'acme', null);
        $domain = $this->activeDomain($this->account, 'portal.example.org', $this->dns);

        $this->allow($this->account, AllowanceKind::CustomDomain, 0);
        Artisan::call('branding:check-addresses');
        $this->travel(30)->days();
        Artisan::call('branding:check-addresses');

        $this->assertSame(PortalAddressState::Released, $domain->refresh()->state);
        $this->assertSame(PortalAddressState::Active, $name->refresh()->state);
        $this->assertNull($name->allowance_off_since);
    }

    public function test_the_owners_are_told_once_when_a_request_lapses_and_see_when_it_did(): void
    {
        $address = app(PortalAddresses::class)->claimDomain($this->account, 'portal.example.org', $this->owner);

        $this->travel(7)->days();
        Artisan::call('branding:check-addresses');
        Artisan::call('branding:check-addresses');

        $this->assertSame(PortalAddressState::Lapsed, $address->refresh()->state);
        Queue::assertPushed(DeliverBillingEmail::class, 1);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->userId === $this->owner->id
            && $job->mail instanceof PortalAddressMail && $job->mail->event === PortalAddressMail::LAPSED && $job->mail->days === 7);
        $this->getJson("/api/v1/billing-accounts/{$this->account->uuid}/branding")->assertOk()
            ->assertJsonPath('data.addresses.0.state', 'lapsed')
            ->assertJsonPath('data.addresses.0.lapsed_at', '2026-12-08T10:00:00+00:00');
    }

    public function test_the_owners_are_told_each_time_a_domain_loses_its_record(): void
    {
        $addresses = app(PortalAddresses::class);
        $address = $this->activeDomain($this->account, 'portal.example.org', $this->dns);
        $target = $this->dns->records['portal.example.org'];
        $record = (string) $addresses->record($address)['value'];

        $lose = function () use ($address): void {
            $this->dns->records = [];
            foreach ([1, 2, 3] as $ignored) {
                $this->travel(16)->minutes();
                Artisan::call('branding:check-addresses');
            }
            $this->assertSame(PortalAddressState::Unreachable, $address->refresh()->state);
        };
        $lose();
        Queue::assertPushed(DeliverBillingEmail::class, 1);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof PortalAddressMail
            && $job->mail->event === PortalAddressMail::UNREACHABLE && $job->mail->record === $record);

        // Still unreachable on the next checks: nothing more is sent.
        $this->travel(16)->minutes();
        Artisan::call('branding:check-addresses');
        Queue::assertPushed(DeliverBillingEmail::class, 1);

        $this->dns->records['portal.example.org'] = $target;
        $this->travel(16)->minutes();
        Artisan::call('branding:check-addresses');
        $this->assertSame(PortalAddressState::Active, $address->refresh()->state);
        $lose();
        Queue::assertPushed(DeliverBillingEmail::class, 2);
    }

    public function test_the_mail_says_what_happened_and_what_to_do(): void
    {
        $lapsed = (new PortalAddressMail('0190a000-0000-7000-8000-000000000001', 'Acme', 'portal.example.org', PortalAddressMail::LAPSED, null, 7))->render();
        $this->assertStringContainsString('was not found within 7 days', $lapsed);
        $this->assertStringContainsString('https://app.example.com/billing?account=0190a000-0000-7000-8000-000000000001', $lapsed);

        $unreachable = new PortalAddressMail('0190a000-0000-7000-8000-000000000001', 'Acme', 'portal.example.org', PortalAddressMail::UNREACHABLE, 'c-abc.example.com');
        $this->assertSame('The DNS record for portal.example.org is missing', $unreachable->envelope()->subject);
        $this->assertStringContainsString('pointing to c-abc.example.com', $unreachable->render());
    }

    public function test_the_release_check_gets_a_name_that_serves_and_its_certificate(): void
    {
        $certificates = $this->fakeCertificates();
        $certificates->expires['acme.example.com'] = '2027-02-20 08:00:00';

        Artisan::call('branding:serving-name');
        $this->assertSame('', trim(Artisan::output()));

        $stopped = BillingAccount::factory()->create();
        $this->allow($stopped);
        app(PortalAddresses::class)->claimName($stopped, 'aaa-stopped', null);
        $this->allow($stopped, AllowanceKind::Branding, 0);
        app(PortalAddresses::class)->claimName($this->account, 'acme', null);

        Artisan::call('branding:serving-name');
        $this->assertSame(
            ['host' => 'acme.example.com', 'certificate_read' => true, 'certificate_expires_at' => '2027-02-20T08:00:00+00:00'],
            json_decode(trim(Artisan::output()), true),
        );
    }

    private function putJsonAs(BillingAccount $account, string $name): TestResponse
    {
        $owner = User::factory()->create();
        $account->owners()->attach($owner->getKey(), ['added_by' => $owner->getKey(), 'created_at' => now()]);

        return $this->actingAs($owner, 'sanctum')->putJson("/api/v1/billing-accounts/{$account->uuid}/addresses/name", ['name' => $name]);
    }
}
