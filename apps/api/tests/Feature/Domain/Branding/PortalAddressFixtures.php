<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\AllowanceOverride;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Contracts\DnsResolver;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Branding\Services\PortalAddresses;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Cookie;

/** A deployment with portal addresses on under `example.com`, and accounts with a brand and a name (spec 036). */
trait PortalAddressFixtures
{
    /** @var array<string, mixed>|null */
    private ?array $requestBaseline = null;

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

    /**
     * A new request, as PHP starts one: the middleware's per-request settings are gone
     * and nobody is resolved yet. One test application otherwise carries both over.
     */
    protected function newRequest(): static
    {
        $this->requestBaseline ??= Arr::only(config()->all(), ['session', 'sanctum', 'passkeys']);
        config($this->requestBaseline);
        Cookie::setDefaultPathAndDomain((string) config('session.path', '/'), config('session.domain'), config('session.secure'), config('session.same_site'));
        Auth::forgetGuards();

        return $this;
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

    /**
     * Puts a fake resolver in place of DNS and returns it: `$dns->records[host] = [targets]`.
     */
    protected function fakeDns(): object
    {
        $dns = new class implements DnsResolver
        {
            /** @var array<string, list<string>> */
            public array $records = [];

            public function cnames(string $host): array
            {
                return $this->records[$host] ?? [];
            }
        };
        $this->app->instance(DnsResolver::class, $dns);
        $this->app->forgetInstance(PortalAddresses::class);

        return $dns;
    }

    /** A custom domain for the account that has found its record and serves. */
    protected function activeDomain(BillingAccount $account, string $host, object $dns): PortalAddress
    {
        $this->allow($account, AllowanceKind::CustomDomain);
        $addresses = app(PortalAddresses::class);
        $address = $addresses->claimDomain($account, $host, null);
        $dns->records[$host] = [$addresses->record($address)['value']];

        return $addresses->check($address);
    }

    protected function addressOf(BillingAccount $account): PortalAddress
    {
        return app(PortalAddresses::class)->for($account)->firstOrFail();
    }
}
