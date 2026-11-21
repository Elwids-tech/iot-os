<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\AllowanceOverride;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Support\Facades\Cache;

/** A deployment with portal addresses on under `example.com`, and accounts with a brand and a name (spec 036). */
trait PortalAddressFixtures
{
    protected function turnAddressesOn(): void
    {
        config([
            'branding.addresses_enabled' => true,
            'branding.domain' => 'example.com',
            'branding.same_origin_names' => false,
            'branding.ask_token' => str_repeat('t', 40),
            'app.url' => 'https://api.example.com',
            'app.frontend_url' => 'https://app.example.com',
            // As the release sets them. An address is added for its own requests only.
            'sanctum.stateful' => ['app.example.com', 'admin.example.com'],
            'cors.allowed_origins' => ['https://app.example.com'],
            'cors.allowed_origins_patterns' => ['#^https://[a-z0-9-]+\.example\.com$#'],
        ]);
    }

    protected function allow(BillingAccount $account, AllowanceKind $kind = AllowanceKind::Branding, int $value = 1): void
    {
        AllowanceOverride::query()->updateOrCreate(
            ['billing_account_id' => $account->getKey(), 'kind' => $kind->value],
            ['value' => $value, 'note' => 'Test'],
        );
        // An allowance change is seen within the address cache's 30 seconds; tests do not wait.
        Cache::flush();
    }

    /** An account allowed to brand, with a brand in effect and a name under the platform's domain. */
    protected function brandedAccount(string $name, string $productName, array $attributes = []): BillingAccount
    {
        $account = BillingAccount::factory()->create($attributes);
        $this->allow($account);
        Brand::query()->create(['billing_account_id' => $account->getKey(), 'product_name' => $productName, 'revision' => 1]);
        app(PortalAddresses::class)->claimName($account, $name, null);

        return $account;
    }

    protected function addressOf(BillingAccount $account): PortalAddress
    {
        return app(PortalAddresses::class)->for($account)->firstOrFail();
    }
}
