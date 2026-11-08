<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\UsageMonthRequest;
use App\Domain\Billing\Http\Resources\UsageResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\MonthlyUsage;
use App\Domain\Billing\Services\Usage;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Platform administrators read a billing account's usage for any month, with each
 * organization's share (spec 028 US2, FR-019). SMS is listed whether or not the
 * deployment can send it.
 */
final class PlatformBillingAccountUsageController
{
    public function __construct(private readonly Usage $usage) {}

    public function show(UsageMonthRequest $request, BillingAccount $billingAccount): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return UsageResource::collection(array_map(
            fn (MonthlyUsage $usage): UsageResource => new UsageResource($usage),
            $this->usage->forAccount($billingAccount, $request->month()),
        ));
    }
}
