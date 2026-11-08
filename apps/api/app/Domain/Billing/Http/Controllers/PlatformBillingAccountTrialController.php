<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\TrialRequest;
use App\Domain\Billing\Http\Resources\BillingAccountDetailResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Trials;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Trials on a billing account (spec 029 US8): start one, extend, shorten or move it to
 * another plan, end it now, or turn it into the paid plan. Each returns the account's
 * page. 409 when a trial is already open (start) or none is (the others).
 */
final class PlatformBillingAccountTrialController
{
    public function __construct(private readonly Trials $trials) {}

    public function store(TrialRequest $request, BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $this->trials->start($billingAccount, $request->plan(), $request->endsAt(), $request->user(), $request->boolean('confirm_retention'));

        return BillingAccountDetailResource::for($billingAccount);
    }

    public function update(TrialRequest $request, BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $this->trials->change($billingAccount, $request->endsAt(), $request->plan(), $request->user(), $request->boolean('confirm_retention'));

        return BillingAccountDetailResource::for($billingAccount);
    }

    /**
     * Ends the trial now: the paid plan with a saved card, else "trial ended, no payment method".
     */
    public function end(Request $request, BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $this->trials->end($billingAccount, $request->user());

        return BillingAccountDetailResource::for($billingAccount);
    }

    /**
     * Turns a trial, or one that ended without a card, into the paid plan; charged from the next day.
     */
    public function convert(Request $request, BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $this->trials->convert($billingAccount, $request->user());

        return BillingAccountDetailResource::for($billingAccount);
    }
}
