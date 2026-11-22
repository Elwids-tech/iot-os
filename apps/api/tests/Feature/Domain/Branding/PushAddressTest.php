<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\PushFixtures;
use Tests\TestCase;

/**
 * Push belongs to the address it was turned on at (spec 036, research R12, FR-032): a
 * device remembers its address, an alert is not pushed to another account's address,
 * and the portal learns that the person has push on elsewhere.
 */
final class PushAddressTest extends TestCase
{
    use PortalAddressFixtures, PushFixtures, RefreshDatabase;

    private Organization $acme;

    private Organization $northstar;

    private User $operator;

    private PortalAddress $acmeAddress;

    private PortalAddress $northstarAddress;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->turnAddressesOn();
        $this->enablePush();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        // A member of both organizations, which are under different billing accounts.
        $this->operator = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->assertNotSame($this->acme->billing_account_id, $this->northstar->billing_account_id);
        $this->acmeAddress = $this->brand($this->acme->billingAccount, 'acme', 'Acme Monitor');
        $this->northstarAddress = $this->brand($this->northstar->billingAccount, 'northstar', 'Northstar View');
    }

    public function test_a_device_remembers_the_address_push_was_turned_on_at(): void
    {
        $this->actingAs($this->operator, 'sanctum');

        $onPlatform = $this->browserSubscription('Chrome on Android');
        $this->postJson('https://api.example.com/api/v1/notifications/push/devices', $onPlatform, ['Origin' => 'https://app.example.com'])->assertCreated();
        $this->assertNull(PushDevice::forEndpoint($onPlatform['endpoint'])->portal_address_id);

        $onAddress = $this->browserSubscription('Safari on iPhone');
        $this->newRequest()->actingAs($this->operator, 'sanctum');
        $this->postJson('https://api.example.com/api/v1/notifications/push/devices', $onAddress, ['Origin' => 'https://acme.example.com'])->assertCreated();
        $this->assertSame($this->acmeAddress->id, PushDevice::forEndpoint($onAddress['endpoint'])->portal_address_id);

        // The same browser checking in again keeps its address.
        $this->newRequest()->actingAs($this->operator, 'sanctum');
        $this->postJson('https://api.example.com/api/v1/notifications/push/devices/sync', ['endpoint' => $onAddress['endpoint']], ['Origin' => 'https://acme.example.com'])
            ->assertOk()->assertJsonPath('data.status', 'mine');
        $this->assertSame($this->acmeAddress->id, PushDevice::forEndpoint($onAddress['endpoint'])->portal_address_id);
    }

    public function test_an_alert_is_not_pushed_to_another_accounts_address_in_either_direction(): void
    {
        $platform = $this->pushDevice($this->operator, 'Platform');
        $atAcme = $this->at($this->pushDevice($this->operator, 'Acme'), $this->acmeAddress);
        $atNorthstar = $this->at($this->pushDevice($this->operator, 'Northstar'), $this->northstarAddress);

        $for = fn (Organization $organization): array => PushDevice::query()->where('user_id', $this->operator->id)->reaching($organization)->orderBy('id')->pluck('id')->all();

        // The platform's address still gets everything.
        $this->assertSame([$platform->id, $atAcme->id], $for($this->acme));
        $this->assertSame([$platform->id, $atNorthstar->id], $for($this->northstar));
    }

    public function test_every_address_of_the_organizations_account_gets_its_alerts(): void
    {
        $domain = $this->activeDomain($this->acme->billingAccount, 'portal.example.org', $this->fakeDns());
        $atName = $this->at($this->pushDevice($this->operator, 'Name'), $this->acmeAddress);
        $atDomain = $this->at($this->pushDevice($this->operator, 'Domain'), $domain);

        $this->assertSame(
            [$atName->id, $atDomain->id],
            PushDevice::query()->where('user_id', $this->operator->id)->reaching($this->acme)->orderBy('id')->pluck('id')->all(),
        );
    }

    public function test_me_says_how_many_devices_have_push_on_at_other_addresses(): void
    {
        $this->pushDevice($this->operator, 'Platform one');
        $this->pushDevice($this->operator, 'Platform two');
        $this->at($this->pushDevice($this->operator, 'Acme'), $this->acmeAddress);
        $this->pushDevice(User::where('email', 'acme.member@example.test')->firstOrFail(), 'Someone else');

        $this->actingAs($this->operator, 'sanctum');
        $this->getJson('https://api.example.com/api/v1/me', ['Origin' => 'https://app.example.com'])->assertOk()->assertJsonPath('data.push_devices_elsewhere', 1);

        $this->newRequest()->actingAs($this->operator, 'sanctum');
        $this->getJson('https://api.example.com/api/v1/me', ['Origin' => 'https://acme.example.com'])->assertOk()->assertJsonPath('data.push_devices_elsewhere', 2);

        $this->newRequest()->actingAs($this->operator, 'sanctum');
        $this->getJson('https://api.example.com/api/v1/me', ['Origin' => 'https://northstar.example.com'])->assertOk()->assertJsonPath('data.push_devices_elsewhere', 3);
    }

    public function test_a_removed_address_leaves_its_devices_as_the_platforms(): void
    {
        $device = $this->at($this->pushDevice($this->operator), $this->acmeAddress);
        $this->acmeAddress->delete();

        $this->assertNull($device->fresh()->portal_address_id);
    }

    private function brand(BillingAccount $account, string $name, string $productName): PortalAddress
    {
        $this->allow($account);
        Brand::query()->create(['billing_account_id' => $account->getKey(), 'product_name' => $productName, 'revision' => 1]);

        return app(PortalAddresses::class)->claimName($account, $name, null);
    }

    private function at(PushDevice $device, PortalAddress $address): PushDevice
    {
        $device->forceFill(['portal_address_id' => $address->id])->save();

        return $device;
    }
}
