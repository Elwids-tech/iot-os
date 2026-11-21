<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Http\Requests\UpdateBrandRequest;
use App\Domain\Branding\Http\Resources\BrandingResource;
use App\Domain\Branding\Http\Resources\BrandResource;
use App\Domain\Branding\Services\Brands;
use Illuminate\Http\Request;

/**
 * Any billing account's brand for platform staff (spec 036 US6), who edit it on the
 * owner's behalf. The allowance is not checked: staff can prepare a brand before turning
 * branding on, and it takes effect only once the allowance is on.
 */
final class PlatformBrandController
{
    public function __construct(private readonly Brands $brands) {}

    public function show(BillingAccount $billingAccount): BrandingResource
    {
        return new BrandingResource($billingAccount);
    }

    public function update(UpdateBrandRequest $request, BillingAccount $billingAccount): BrandResource
    {
        $brand = $this->brands->update($billingAccount, $request->safe()->only(['product_name', 'short_name', 'support_url']), (int) $request->validated('revision'), $request->user());

        return new BrandResource($brand, $this->brands->inEffect($billingAccount, $brand));
    }

    /** Sets the logo, dark logo or icon from a multipart `image`. */
    public function storeImage(Request $request, BillingAccount $billingAccount, string $role): BrandResource
    {
        $request->validate(['image' => ['required', 'file']]);
        $brand = $this->brands->setImage($billingAccount, $role, $request->file('image'), $request->user());

        return new BrandResource($brand, $this->brands->inEffect($billingAccount, $brand));
    }

    public function destroyImage(Request $request, BillingAccount $billingAccount, string $role): BrandResource
    {
        $brand = $this->brands->removeImage($billingAccount, $role, $request->user());

        return new BrandResource($brand, $this->brands->inEffect($billingAccount, $brand));
    }
}
