<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Services\BrandImages;
use App\Domain\Branding\Services\Brands;
use App\Domain\Branding\Services\PortalAddresses;
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
        $addresses = app(PortalAddresses::class);
        $domain = $addresses->domain();
        $live = $addresses->for($account);
        $lapsed = $addresses->lapsedFor($account);

        return [
            'brand' => new BrandResource($brand, $brands->inEffect($account, $brand)),
            /**
             * The account's portal addresses: at most one name and one custom domain. A
             * domain request that lapsed is listed until the account asks again.
             */
            'addresses' => PortalAddressResource::collection($live->contains('kind', PortalAddressKind::Domain) || $lapsed === null ? $live : $live->push($lapsed)),
            /** What the account's plan and overrides turn on. */
            'allowances' => [
                'branding' => $allowances[AllowanceKind::Branding->value]->value === 1,
                'custom_domain' => $allowances[AllowanceKind::CustomDomain->value]->value === 1,
                'hide_powered_by' => $allowances[AllowanceKind::HidePoweredBy->value]->value === 1,
            ],
            /** Whether this deployment serves portal addresses at all. */
            'addresses_available' => (bool) $addresses->enabled(),
            /** What follows a claimed name, such as `.example.com`; null when the deployment has no domain for addresses. */
            'name_suffix' => $domain === null ? null : '.'.$domain,
            'limits' => [
                'image_bytes' => (int) config('branding.images.max_bytes'),
                /** @var list<string> */
                'types' => BrandImages::TYPES,
                'icon_min' => (int) config('branding.images.icon_min'),
            ],
        ];
    }
}
