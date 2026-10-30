<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Billing\Http\Resources\OwnedBillingAccountResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The billing accounts the signed-in person owns (spec 023 US3). Not paginated: one
 * person owns few accounts. Anyone else's accounts are never listed.
 */
final class OwnedBillingAccountController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $memberOf = $user->organizations()->pluck('organizations.id')->map(fn ($id): int => (int) $id)->all();

        $accounts = $user->ownedBillingAccounts()
            ->with(['organizations' => fn ($query) => $query->orderBy('name')])
            ->orderBy('name')
            ->get();

        return OwnedBillingAccountResource::collection(
            $accounts->map(fn (BillingAccount $account) => new OwnedBillingAccountResource($account, $memberOf)),
        );
    }
}
