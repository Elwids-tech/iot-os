<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Enums\PriceKind;
use App\Domain\Billing\Http\Requests\OverridePriceRequest;
use App\Domain\Billing\Http\Requests\UpdateBillingDetailsRequest;
use App\Domain\Billing\Http\Resources\BillingAccountDetailResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\TaxRate;
use App\Domain\Billing\Services\BillingDetails;
use App\Domain\Billing\Services\Prices;
use Illuminate\Support\Facades\Gate;

/**
 * One account's price overrides, from next month (spec 029 FR-028), and its billing
 * details for invoices (FR-029). The override's response says from when it applies.
 */
final class PlatformBillingAccountPriceController
{
    public function __construct(private readonly Prices $prices, private readonly BillingDetails $details) {}

    public function update(OverridePriceRequest $request, BillingAccount $billingAccount, string $price): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $value = $request->validated('value');
        $from = $this->prices->override(
            $billingAccount,
            PriceKind::from($price),
            $value === null ? null : (int) $value,
            $request->validated('note'),
            $request->user(),
        );

        return BillingAccountDetailResource::for($billingAccount)->additional(['effective_from' => $from->toDateString()]);
    }

    public function details(UpdateBillingDetailsRequest $request, BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $rate = $request->validated('tax_rate_uuid');
        $this->details->update(
            $billingAccount,
            $request->validated('billing_address'),
            $request->validated('tax_number'),
            $rate === null ? null : TaxRate::query()->where('uuid', $rate)->firstOrFail(),
            $request->user(),
        );

        return BillingAccountDetailResource::for($billingAccount);
    }
}
