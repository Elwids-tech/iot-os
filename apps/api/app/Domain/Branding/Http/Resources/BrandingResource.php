<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Services\BrandImages;
use App\Domain\Branding\Services\Brands;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Everything the branding pages read for one billing account (spec 036,
 * contracts/branding-api.md): its brand, its portal addresses, what its plan allows and
 * the image limits.
 *
 * @extends JsonResource<BillingAccount>
 */
final class BrandingResource extends JsonResource
{
    public function __construct(BillingAccount $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var BillingAccount $account */
        $account = $this->resource;
        $brands = app(Brands::class);
        $allowances = app(Allowances::class)->all($account);
        $brand = $brands->for($account);
        $domain = config('branding.domain');

        return [
            'brand' => new BrandResource($brand, $brands->inEffect($account, $brand)),
            /**
             * The account's portal addresses. Always empty until addresses are available.
             *
             * @var list<array{uuid: string, kind: 'name'|'domain', host: string, state: 'waiting_dns'|'active'|'unreachable'|'suspended'|'lapsed', main: bool}>
             */
            'addresses' => [],
            /** What the account's plan and overrides turn on. */
            'allowances' => [
                'branding' => $allowances[AllowanceKind::Branding->value]->value === 1,
                'custom_domain' => $allowances[AllowanceKind::CustomDomain->value]->value === 1,
                'hide_powered_by' => $allowances[AllowanceKind::HidePoweredBy->value]->value === 1,
            ],
            /** Whether this deployment serves portal addresses at all. */
            'addresses_available' => (bool) config('branding.addresses_enabled'),
            /** What follows a claimed name, such as `.example.com`; null when the deployment has no domain for addresses. */
            'name_suffix' => is_string($domain) && $domain !== '' ? '.'.$domain : null,
            'limits' => [
                'image_bytes' => (int) config('branding.images.max_bytes'),
                /** @var list<string> */
                'types' => BrandImages::TYPES,
                'icon_min' => (int) config('branding.images.icon_min'),
            ],
        ];
    }
}
