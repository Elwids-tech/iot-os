<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Controllers;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Http\Requests\UpdateBrandRequest;
use App\Domain\Branding\Http\Resources\BrandingResource;
use App\Domain\Branding\Http\Resources\BrandResource;
use App\Domain\Branding\Services\Brands;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;

/**
 * A billing account's brand for its owners (spec 036 US1). An account the signed-in
 * person does not own answers 404. Changes need the account's `branding` allowance;
 * reading does not, so the page can say branding is not part of the plan.
 */
final class OwnedBrandController
{
    public function __construct(
        private readonly Brands $brands,
        private readonly Allowances $allowances,
    ) {}

    public function show(Request $request, string $billingAccount): BrandingResource
    {
        return new BrandingResource($this->account($request, $billingAccount));
    }

    public function update(UpdateBrandRequest $request, string $billingAccount): BrandResource
    {
        $account = $this->account($request, $billingAccount, changing: true);
        $brand = $this->brands->update($account, $request->safe()->only(['product_name', 'short_name', 'support_url']), (int) $request->validated('revision'), $request->user());

        return new BrandResource($brand, $this->brands->inEffect($account, $brand));
    }

    /** Sets the logo, dark logo or icon from a multipart `image`. */
    public function storeImage(Request $request, string $billingAccount, string $role): BrandResource
    {
        $account = $this->account($request, $billingAccount, changing: true);
        $request->validate(['image' => ['required', 'file']]);
        $brand = $this->brands->setImage($account, $role, $request->file('image'), $request->user());

        return new BrandResource($brand, $this->brands->inEffect($account, $brand));
    }

    public function destroyImage(Request $request, string $billingAccount, string $role): BrandResource
    {
        $account = $this->account($request, $billingAccount, changing: true);
        $brand = $this->brands->removeImage($account, $role, $request->user());

        return new BrandResource($brand, $this->brands->inEffect($account, $brand));
    }

    private function account(Request $request, string $uuid, bool $changing = false): BillingAccount
    {
        /** @var User $user */
        $user = $request->user();
        /** @var BillingAccount|null $account */
        $account = $user->ownedBillingAccounts()->where('billing_accounts.uuid', $uuid)->first();
        abort_if($account === null, 404);

        if ($changing && ! $this->allowances->allows($account, AllowanceKind::Branding)) {
            throw new BrandingRefusal(403, 'branding_not_allowed', 'Branding is not part of this billing account\'s plan.');
        }

        return $account;
    }
}
