<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Resources\BillingAccountOwnerResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Platform administrators add and remove a billing account's owners (spec 023 D4).
 * Both are idempotent, and memberships never change.
 */
final class PlatformBillingAccountOwnerController
{
    public function __construct(private readonly BillingAccounts $billingAccounts) {}

    public function update(Request $request, BillingAccount $billingAccount, User $user): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $this->billingAccounts->addOwner($billingAccount, $user, $request->user());

        return BillingAccountOwnerResource::collection($billingAccount->owners()->orderBy('name')->get());
    }

    public function destroy(Request $request, BillingAccount $billingAccount, User $user): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $this->billingAccounts->removeOwner($billingAccount, $user, $request->user());

        return response()->noContent();
    }
}
