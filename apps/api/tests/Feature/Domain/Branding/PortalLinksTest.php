<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Authentication\Notifications\PasswordResetNotification;
use App\Domain\Billing\Mail\UsageThresholdMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Services\PortalAccess;
use App\Domain\Branding\Services\PortalLinks;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Where links for people open (spec 036, research R11, FR-016, FR-029, FR-033): an
 * organization's on its account's main address, a request's on the address it came
 * from, and billing on the platform's portal.
 */
final class PortalLinksTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase;

    private BillingAccount $account;

    private Organization $organization;

    private PortalLinks $links;

    protected function setUp(): void
    {
        parent::setUp();
        $this->turnAddressesOn();
        $this->account = $this->brandedAccount('acme', 'Acme Monitor');
        $this->organization = Organization::factory()->forBillingAccount($this->account)->create();
        $this->links = app(PortalLinks::class);
    }

    public function test_an_organizations_links_use_its_accounts_domain_while_it_serves(): void
    {
        $this->activeDomain($this->account, 'portal.example.org', $this->fakeDns());

        $this->assertSame('https://portal.example.org/organizations/x/home', app(PortalLinks::class)->forOrganization($this->organization, 'organizations/x/home'));
        $this->assertSame('https://portal.example.org', app(PortalLinks::class)->forOrganization($this->organization));
    }

    public function test_they_fall_back_to_the_name_when_the_domain_is_unreachable_or_absent(): void
    {
        $this->assertSame('https://acme.example.com/alerts', $this->links->forOrganization($this->organization, '/alerts'));

        $domain = $this->activeDomain($this->account, 'portal.example.org', $this->fakeDns());
        $domain->forceFill(['state' => PortalAddressState::Unreachable])->save();
        Cache::flush();

        $this->assertSame('https://acme.example.com/alerts', app(PortalLinks::class)->forOrganization($this->organization, 'alerts'));
    }

    public function test_an_account_with_no_address_gets_the_platforms(): void
    {
        $plain = Organization::factory()->create();

        $this->assertSame('https://app.example.com/alerts', $this->links->forOrganization($plain, 'alerts'));
        $this->assertSame('https://app.example.com', $this->links->forOrganization(null));
    }

    public function test_an_address_that_lost_its_allowance_is_not_linked_to(): void
    {
        $this->allow($this->account, value: 0);

        $this->assertSame('https://app.example.com/alerts', $this->links->forOrganization($this->organization, 'alerts'));
    }

    public function test_with_addresses_switched_off_every_link_is_the_platforms(): void
    {
        config(['branding.addresses_enabled' => false]);

        $this->assertSame('https://app.example.com/alerts', $this->links->forOrganization($this->organization, 'alerts'));
    }

    public function test_request_links_use_the_address_the_request_came_from(): void
    {
        $request = Request::create('https://api.example.com/api/v1/auth/forgot-password');
        $this->assertSame('https://app.example.com/reset-password', $this->links->forRequest('reset-password', $request));
        $this->assertNull($this->links->origin($request));

        $request->attributes->set(PortalAccess::ATTRIBUTE, $this->addressOf($this->account));
        $this->assertSame('https://acme.example.com/reset-password', $this->links->forRequest('reset-password', $request));
        $this->assertSame('acme.example.com', $this->links->origin($request));
    }

    public function test_a_queued_mail_keeps_the_address_it_was_asked_for_at(): void
    {
        $this->app->instance('request', tap(Request::create('https://api.example.com/api/v1/auth/forgot-password'), fn (Request $request) => $request->attributes->set(PortalAccess::ATTRIBUTE, $this->addressOf($this->account))));
        $notification = unserialize(serialize(new PasswordResetNotification('secret-token')));

        // The worker has no request.
        $this->app->instance('request', Request::create('http://localhost'));
        $user = User::factory()->create();
        $mail = $notification->toMail($user);

        $this->assertStringStartsWith('https://acme.example.com/reset-password#', $mail->actionUrl);
        $this->assertSame('Reset your Acme Monitor password', $mail->subject);
    }

    public function test_a_kept_address_that_stopped_serving_falls_back_to_the_platforms(): void
    {
        $this->assertSame('https://acme.example.com/account/security', $this->links->at('acme.example.com', 'account/security'));

        $this->addressOf($this->account)->forceFill(['state' => PortalAddressState::Suspended])->save();
        Cache::flush();

        $this->assertSame('https://app.example.com/account/security', $this->links->at('acme.example.com', 'account/security'));
        $this->assertSame('https://app.example.com/account/security', $this->links->at(null, 'account/security'));
    }

    public function test_billing_mail_links_to_the_platforms_portal(): void
    {
        $this->activeDomain($this->account, 'portal.example.org', $this->fakeDns());
        $text = (new UsageThresholdMail($this->account->uuid, 'Acme Billing', 'sms', '2026-11-01', 80, 4, 5))->render();

        $this->assertStringContainsString('https://app.example.com/billing?account='.$this->account->uuid, $text);
        $this->assertStringNotContainsString('portal.example.org', $text);
        $this->assertSame('https://app.example.com/billing', $this->links->platform('billing'));
    }
}
