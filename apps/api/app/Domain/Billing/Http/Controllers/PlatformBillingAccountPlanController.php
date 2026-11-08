<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\SetBillingAccountPlanRequest;
use App\Domain\Billing\Http\Resources\BillingAccountDetailResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Services\PlanAssignments;
use Illuminate\Support\Facades\Gate;

/**
 * Puts a billing account on a plan or takes it off (spec 028 US2).
 */
final class PlatformBillingAccountPlanController
{
    public function __construct(private readonly PlanAssignments $assignments) {}

    public function update(SetBillingAccountPlanRequest $request, BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $planUuid = $request->validated('plan_uuid');

        if ($planUuid === null) {
            $this->assignments->remove($billingAccount, $request->user(), $request->boolean('confirm_retention'));
        } else {
            $plan = BillingPlan::query()->where('uuid', $planUuid)->firstOrFail();
            $this->assignments->assign($billingAccount, $plan, $request->user(), confirmRetention: $request->boolean('confirm_retention'));
        }

        return BillingAccountDetailResource::for($billingAccount);
    }
}
