<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Models\BrandAsset;
use Illuminate\Support\Str;

/**
 * What the portal learns about its host before it starts (spec 036, research R9,
 * contracts/portal-bootstrap.md). The portal's proxy sends `/runtime-config.js` here for
 * every host that is not the platform's own, and the page's first script reads the
 * brand from it, so the platform's name is never drawn on an account's address.
 */
final class PortalBootstrap
{
    public function __construct(
        private readonly PortalAddresses $addresses,
        private readonly Brands $brands,
        private readonly Allowances $allowances,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function for(string $host): array
    {
        $address = $this->addresses->resolve($host);
        if ($address === null) {
            $moved = $this->addresses->redirectFor($host);

            // Nothing about the deployment is told to a host that is not in use.
            return [
                'VITE_API_URL' => '',
                'VITE_PORTAL_URL' => '',
                'VITE_ADMIN_URL' => '',
                'VITE_MAP_STYLE_URL' => '',
                'environment' => (string) config('branding.portal.environment'),
                'address' => $moved === null
                    ? ['state' => 'not_in_use']
                    : ['state' => 'moved', 'to' => $this->addresses->url($moved)],
                'sign_up' => false,
            ];
        }

        $account = $address->billingAccount;
        $brand = $account === null ? null : $this->brands->for($account);
        // A custom domain serves the API on its own host; a name calls the platform's.
        $api = $address->kind === PortalAddressKind::Domain || config('branding.same_origin_names')
            ? ''
            : rtrim((string) config('app.url'), '/');
        $image = static fn (?BrandAsset $asset, ?string $variant = null): ?string => $asset === null
            ? null
            : $api.route('api.v1.brand-assets.show', ['asset' => $asset->publicKey(), 'variant' => $variant ?? $asset->mainVariant()], false);

        return [
            'VITE_API_URL' => $api,
            'VITE_PORTAL_URL' => $this->addresses->url($address),
            // The admin app stays on the platform's domain and is never named on an address.
            'VITE_ADMIN_URL' => '',
            'VITE_MAP_STYLE_URL' => (string) config('branding.portal.map_style_url'),
            'environment' => (string) config('branding.portal.environment'),
            'address' => ['kind' => $address->kind->value, 'host' => $address->host, 'state' => $address->state->value],
            'brand' => $account === null || $brand === null || ! $this->brands->inEffect($account, $brand) ? null : [
                'product_name' => (string) $brand->product_name,
                'short_name' => $brand->short_name ?? Str::limit((string) $brand->product_name, 12, ''),
                'support_url' => $brand->support_url,
                'logo' => $image($brand->logo),
                'logo_dark' => $image($brand->logoDark),
                'icon' => $image($brand->icon, '192'),
                'touch_icon' => $image($brand->icon, '180'),
                'powered_by' => $this->allowances->allows($account, AllowanceKind::HidePoweredBy) ? null : (string) config('branding.platform_name'),
            ],
            'sign_up' => false,
        ];
    }

    /** The one statement `runtime-config.js` holds. `JSON_HEX_TAG` keeps a product name from closing the script. */
    public function script(string $host): string
    {
        return 'window.__IOT_CONFIG__ = '.json_encode(
            $this->for($host),
            JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
        ).";\n";
    }
}
