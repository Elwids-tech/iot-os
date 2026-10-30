<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\MoveOrganizationRequest;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Platform administrators move an organization to another billing account (spec 023
 * FR-012). Nothing inside the organization changes, and the limit does not apply.
 */
final class PlatformOrganizationBillingAccountController
{
    public function __construct(private readonly BillingAccounts $billingAccounts) {}

    public function update(MoveOrganizationRequest $request, Organization $organization): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $target = BillingAccount::query()->where('uuid', $request->validated('billing_account_uuid'))->firstOrFail();
        $this->billingAccounts->move($organization, $target, $request->user());

        return response()->noContent();
    }
}
