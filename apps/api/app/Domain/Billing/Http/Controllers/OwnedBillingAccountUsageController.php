<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Billing\Http\Requests\UsageMonthRequest;
use App\Domain\Billing\Http\Resources\UsageResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\MonthlyUsage;
use App\Domain\Billing\Services\Usage;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * An owner reads a billing account's usage for a month, with each organization's share
 * (spec 028 FR-021). Any other account answers 404. Without an SMS provider on the
 * deployment, SMS is left out.
 */
final class OwnedBillingAccountUsageController
{
    public function __construct(private readonly Usage $usage) {}

    public function show(UsageMonthRequest $request, string $billingAccount): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        /** @var BillingAccount|null $account */
        $account = $user->ownedBillingAccounts()->where('billing_accounts.uuid', $billingAccount)->first();
        abort_if($account === null, 404);

        return UsageResource::collection(array_map(
            fn (MonthlyUsage $usage): UsageResource => new UsageResource($usage),
            $this->usage->forAccount($account, $request->month(), withSms: Usage::smsAvailable()),
        ));
    }
}
