<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Http\Requests\OverrideAllowanceRequest;
use App\Domain\Billing\Http\Resources\BillingAccountDetailResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Overrides one of a billing account's allowances, or removes the override (spec 028
 * FR-008).
 */
final class PlatformBillingAccountAllowanceController
{
    public function __construct(private readonly Allowances $allowances) {}

    public function update(OverrideAllowanceRequest $request, BillingAccount $billingAccount, string $kind): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $value = $request->validated('value');
        $this->allowances->override(
            $billingAccount,
            AllowanceKind::from($kind),
            $value === null ? null : (int) $value,
            (string) $request->validated('note'),
            $request->user(),
            $request->boolean('confirm_retention'),
        );

        return BillingAccountDetailResource::for($billingAccount);
    }

    public function destroy(Request $request, BillingAccount $billingAccount, string $kind): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        // A shorter retention needs `confirm_retention`, sent in the body or the query (spec 029 US4).
        $request->validate(['confirm_retention' => ['sometimes', 'boolean']]);
        $this->allowances->removeOverride($billingAccount, AllowanceKind::from($kind), $request->user(), $request->boolean('confirm_retention'));

        return BillingAccountDetailResource::for($billingAccount);
    }
}
