<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Audit\Models\Activity;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** A billing account claims one name under the platform's domain (spec 036 US1, FR-010, FR-012, FR-018). */
final class PortalAddressNameTest extends TestCase
{
    use PortalAddressFixtures, RefreshDatabase;

    private User $owner;

    private BillingAccount $account;

    protected function setUp(): void
    {
        parent::setUp();
        $this->turnAddressesOn();
        $this->owner = User::factory()->create();
        $this->account = BillingAccount::factory()->ownedBy($this->owner)->create();
        $this->allow($this->account);
        $this->actingAs($this->owner, 'sanctum');
    }

    public function test_an_owner_claims_a_name_and_it_serves_at_once(): void
    {
        $this->putJson($this->url('addresses/name'), ['name' => 'Acme'])
            ->assertOk()
            ->assertJsonPath('data.kind', 'name')
            ->assertJsonPath('data.host', 'acme.example.com')
            ->assertJsonPath('data.url', 'https://acme.example.com')
            ->assertJsonPath('data.state', 'active')
            ->assertJsonPath('data.main', true);

        $this->getJson($this->url('branding'))->assertOk()
            ->assertJsonPath('data.addresses_available', true)
            ->assertJsonPath('data.name_suffix', '.example.com')
            ->assertJsonCount(1, 'data.addresses')
            ->assertJsonPath('data.addresses.0.host', 'acme.example.com');

        $this->assertNotNull(app(PortalAddresses::class)->resolve('ACME.example.com:443'));
        $entry = Activity::query()->where('event', 'portal_address.claimed')->sole();
        $this->assertSame($this->owner->id, $entry->causer_id);
        $this->assertSame('acme.example.com', $entry->properties['host']);
    }

    public function test_names_that_are_reserved_taken_or_not_host_names_are_refused(): void
    {
        foreach (['admin', 'api', 'app', 'c-abc123'] as $reserved) {
            $this->putJson($this->url('addresses/name'), ['name' => $reserved])->assertStatus(409)->assertJsonPath('code', 'name_reserved');
        }
        foreach (['ab', str_repeat('a', 41), '-acme', 'acme-', 'ac me', 'acme.shop', 'acme_shop', 'a--b', 'ácme'] as $invalid) {
            $this->putJson($this->url('addresses/name'), ['name' => $invalid])->assertStatus(422)->assertJsonPath('code', 'name_invalid')->assertJsonValidationErrors('name');
        }
        $this->putJson($this->url('addresses/name'), [])->assertStatus(422);

        $this->brandedAccount('acme', 'Other Monitor');
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertStatus(409)->assertJsonPath('code', 'name_taken');
        $this->assertSame(0, $this->account->portalAddresses()->count());
    }

    public function test_an_account_holds_one_name_and_a_renamed_one_redirects_for_thirty_days(): void
    {
        $addresses = app(PortalAddresses::class);
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk();
        // The same name again changes nothing.
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk();
        $this->assertSame(1, PortalAddress::query()->count());

        $this->putJson($this->url('addresses/name'), ['name' => 'acme-monitor'])->assertOk()->assertJsonPath('data.host', 'acme-monitor.example.com');
        $this->assertSame(['acme-monitor.example.com'], $addresses->for($this->account)->pluck('host')->all());
        $this->assertNull($addresses->resolve('acme.example.com'));
        $this->assertSame('acme-monitor.example.com', $addresses->redirectFor('acme.example.com')?->host);

        // A second rename: both earlier names lead to the newest.
        $this->putJson($this->url('addresses/name'), ['name' => 'acme-view'])->assertOk();
        $this->assertSame('acme-view.example.com', $addresses->redirectFor('acme.example.com')?->host);
        $this->assertSame('acme-view.example.com', $addresses->redirectFor('acme-monitor.example.com')?->host);

        // Another account cannot take the old name while it is held (FR-018).
        $other = User::factory()->create();
        $theirs = BillingAccount::factory()->ownedBy($other)->create();
        $this->allow($theirs);
        $this->actingAs($other, 'sanctum')->putJson("/api/v1/billing-accounts/{$theirs->uuid}/addresses/name", ['name' => 'acme'])
            ->assertStatus(409)->assertJsonPath('code', 'name_taken');

        $this->travel(31)->days();
        $this->assertNull($addresses->redirectFor('acme.example.com'));
        $this->actingAs($other, 'sanctum')->putJson("/api/v1/billing-accounts/{$theirs->uuid}/addresses/name", ['name' => 'acme'])
            ->assertOk()->assertJsonPath('data.host', 'acme.example.com');
    }

    public function test_an_account_takes_back_a_name_it_released(): void
    {
        $uuid = $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk()->json('data.uuid');
        $this->deleteJson($this->url("addresses/{$uuid}"))->assertNoContent();
        $this->assertNull(app(PortalAddresses::class)->resolve('acme.example.com'));
        $this->getJson($this->url('branding'))->assertJsonCount(0, 'data.addresses');
        $this->assertSame(1, Activity::query()->where('event', 'portal_address.released')->count());

        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk()->assertJsonPath('data.state', 'active');
        $this->assertSame(1, PortalAddress::query()->count());
    }

    public function test_claims_need_the_allowance_and_the_deployment_switch(): void
    {
        $this->allow($this->account, AllowanceKind::Branding, 0);
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertStatus(403)->assertJsonPath('code', 'branding_not_allowed');

        $this->allow($this->account);
        config(['branding.addresses_enabled' => false]);
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertStatus(409)->assertJsonPath('code', 'addresses_unavailable');
        $this->getJson($this->url('branding'))->assertJsonPath('data.addresses_available', false);

        config(['branding.addresses_enabled' => true, 'branding.domain' => null]);
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertStatus(409)->assertJsonPath('code', 'addresses_unavailable');
        $this->assertSame(0, PortalAddress::query()->count());
    }

    public function test_an_address_stops_serving_without_the_allowance_and_returns_with_it(): void
    {
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk();
        $addresses = app(PortalAddresses::class);

        $this->allow($this->account, AllowanceKind::Branding, 0);
        $this->assertNull($addresses->resolve('acme.example.com'));
        $this->assertNull($addresses->mainFor($this->account));
        // The name is kept, unused (FR-037).
        $this->assertSame(PortalAddressState::Active, $this->addressOf($this->account)->state);

        $this->allow($this->account);
        $this->assertNotNull($addresses->resolve('acme.example.com'));
    }

    public function test_another_accounts_owner_gets_404_and_staff_act_for_any_account(): void
    {
        $uuid = $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk()->json('data.uuid');
        $stranger = User::factory()->create();
        $theirs = BillingAccount::factory()->ownedBy($stranger)->create();
        $this->allow($theirs);

        $this->actingAs($stranger, 'sanctum');
        $this->putJson($this->url('addresses/name'), ['name' => 'other'])->assertNotFound();
        $this->deleteJson($this->url("addresses/{$uuid}"))->assertNotFound();
        // Their own account cannot remove another account's address either.
        $this->deleteJson("/api/v1/billing-accounts/{$theirs->uuid}/addresses/{$uuid}")->assertNotFound();
        $this->putJson("/api/v1/admin/billing-accounts/{$this->account->uuid}/addresses/name", ['name' => 'other'])->assertForbidden();
        $this->assertSame('acme.example.com', $this->addressOf($this->account)->host);

        $staff = User::factory()->create(['is_super_admin' => true]);
        $this->actingAs($staff, 'sanctum')
            ->putJson("/api/v1/admin/billing-accounts/{$this->account->uuid}/addresses/name", ['name' => 'acme-two'])
            ->assertOk()->assertJsonPath('data.host', 'acme-two.example.com');
        $this->deleteJson("/api/v1/admin/billing-accounts/{$this->account->uuid}/addresses/".$this->addressOf($this->account)->uuid)->assertNoContent();
    }

    public function test_a_suspended_address_does_not_serve_and_its_owner_cannot_change_it(): void
    {
        $uuid = $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk()->json('data.uuid');
        $addresses = app(PortalAddresses::class);
        $staff = User::factory()->create(['is_super_admin' => true]);

        $addresses->suspend($this->addressOf($this->account), $staff);
        $this->assertNull($addresses->resolve('acme.example.com'));
        $this->getJson($this->url('branding'))->assertJsonPath('data.addresses.0.state', 'suspended')->assertJsonPath('data.addresses.0.main', false);
        $this->deleteJson($this->url("addresses/{$uuid}"))->assertStatus(409)->assertJsonPath('code', 'suspended');
        $this->putJson($this->url('addresses/name'), ['name' => 'acme-two'])->assertStatus(409)->assertJsonPath('code', 'suspended');

        $addresses->restore($this->addressOf($this->account), $staff);
        $this->assertNotNull($addresses->resolve('acme.example.com'));
        $this->assertSame(['portal_address.claimed', 'portal_address.suspended', 'portal_address.restored'], Activity::query()->where('event', 'like', 'portal_address.%')->orderBy('id')->pluck('event')->all());
    }

    public function test_an_accounts_addresses_are_released_when_it_is_deleted_or_left_empty(): void
    {
        $staff = User::factory()->create(['is_super_admin' => true]);
        $organization = Organization::factory()->create(['billing_account_id' => $this->account->id]);
        $this->putJson($this->url('addresses/name'), ['name' => 'acme'])->assertOk();

        $target = BillingAccount::factory()->create();
        app(BillingAccounts::class)->move($organization, $target, $staff);

        $this->assertSame(PortalAddressState::Released, PortalAddress::query()->sole()->state);
        $this->assertNull(app(PortalAddresses::class)->resolve('acme.example.com'));
        $this->assertSame('no_organizations', Activity::query()->where('event', 'portal_address.released')->sole()->properties['reason']);
    }

    private function url(string $path): string
    {
        return "/api/v1/billing-accounts/{$this->account->uuid}/{$path}";
    }
}
