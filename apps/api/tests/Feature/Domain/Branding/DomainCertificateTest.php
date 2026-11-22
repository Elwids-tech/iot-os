<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\User;
use App\Support\Operations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The custom domain check also reads when the domain's certificate expires, so a
 * renewal that keeps failing reaches staff and the owner before visitors (spec 036,
 * edge case "the secure connection cannot be renewed", T101).
 */
final class DomainCertificateTest extends TestCase
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

    public function test_a_serving_domains_check_records_when_its_certificate_expires(): void
    {
        $this->travelTo('2026-12-01 10:00:00');
        $certificates = $this->fakeCertificates();
        $certificates->expires['portal.example.org'] = '2027-02-20 08:00:00';

        $domain = $this->activeDomain($this->account, 'portal.example.org', $this->dns);

        $this->assertSame('2027-02-20T08:00:00+00:00', $domain->certificate_expires_at?->toIso8601String());
        $this->assertSame('2026-12-01T10:00:00+00:00', $domain->certificate_checked_at?->toIso8601String());
        $this->getJson("/api/v1/billing-accounts/{$this->account->uuid}/branding")->assertOk()
            ->assertJsonPath('data.addresses.0.certificate_expires_at', '2027-02-20T08:00:00+00:00')
            ->assertJsonPath('data.addresses.0.certificate_expiring', false);
        $this->assertStringContainsString(
            'iot_portal_address_certificate_expiry_timestamp_seconds{host="portal.example.org"} '.$domain->certificate_expires_at->getTimestamp(),
            $this->certificateMetrics(),
        );
    }

    public function test_a_read_that_fails_keeps_the_last_expiry_which_then_shows_as_expiring(): void
    {
        $this->travelTo('2026-12-01 10:00:00');
        $certificates = $this->fakeCertificates();
        $certificates->expires['portal.example.org'] = '2026-12-20 08:00:00';
        $domain = $this->activeDomain($this->account, 'portal.example.org', $this->dns);

        // Renewal keeps failing: the proxy stops answering for the host, and the date comes closer.
        unset($certificates->expires['portal.example.org']);
        $this->travelTo('2026-12-07 10:00:00');
        $domain = app(PortalAddresses::class)->check($domain);

        $this->assertSame('2026-12-20T08:00:00+00:00', $domain->certificate_expires_at?->toIso8601String());
        $this->assertSame('2026-12-07T10:00:00+00:00', $domain->certificate_checked_at?->toIso8601String());
        $this->getJson("/api/v1/billing-accounts/{$this->account->uuid}/branding")->assertOk()
            ->assertJsonPath('data.addresses.0.certificate_expiring', true);
    }

    public function test_a_domain_whose_certificate_was_never_read_reports_zero_so_the_alert_fires(): void
    {
        $this->fakeCertificates();
        $this->activeDomain($this->account, 'portal.example.org', $this->dns);

        $this->assertStringContainsString('iot_portal_address_certificate_expiry_timestamp_seconds{host="portal.example.org"} 0', $this->certificateMetrics());
        // Nothing is known yet, so the owner is not warned.
        $this->getJson("/api/v1/billing-accounts/{$this->account->uuid}/branding")->assertOk()
            ->assertJsonPath('data.addresses.0.certificate_expires_at', null)
            ->assertJsonPath('data.addresses.0.certificate_expiring', false);
    }

    public function test_nothing_is_read_or_reported_without_a_proxy_to_ask_for_a_waiting_domain_or_for_a_name(): void
    {
        // No proxy: the default in development and in tests.
        $domain = $this->activeDomain($this->account, 'portal.example.org', $this->dns);
        $this->assertNull($domain->certificate_checked_at);
        $this->assertSame('', $this->certificateMetrics());

        $other = BillingAccount::factory()->ownedBy($this->owner)->create();
        $this->allow($other);
        $this->allow($other, AllowanceKind::CustomDomain);
        $certificates = $this->fakeCertificates();
        $certificates->expires['waiting.example.org'] = '2027-02-20 08:00:00';
        $addresses = app(PortalAddresses::class);
        $waiting = $addresses->check($addresses->claimDomain($other, 'waiting.example.org', null));
        $name = $addresses->check($addresses->claimName($other, 'other', null));

        $this->assertNull($waiting->certificate_checked_at);
        $this->assertNull($name->certificate_checked_at);
        $this->assertSame('', $this->certificateMetrics());
    }

    /** The certificate lines of the metrics, which on SQLite hold nothing else of interest here. */
    private function certificateMetrics(): string
    {
        return implode("\n", array_filter(
            explode("\n", app(Operations::class)->metrics()),
            static fn (string $line): bool => str_contains($line, 'portal_address_certificate'),
        ));
    }
}
