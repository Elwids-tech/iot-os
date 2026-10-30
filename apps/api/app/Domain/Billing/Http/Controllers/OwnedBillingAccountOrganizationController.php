<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Billing\Http\Requests\StoreOwnedOrganizationRequest;
use App\Domain\Billing\Http\Resources\OwnerOrganizationResource;
use App\Domain\Billing\Services\OwnerOrganizations;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * An owner creates an organization under a billing account they own (spec 023 US3).
 * Any other account answers 404, so the answer never confirms that it exists.
 */
final class OwnedBillingAccountOrganizationController
{
    public function __construct(private readonly OwnerOrganizations $organizations) {}

    public function store(StoreOwnedOrganizationRequest $request, string $billingAccount): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $organization = $this->organizations->create(
            $user,
            $billingAccount,
            (string) $request->validated('name'),
            $request->validated('slug'),
        );

        return OwnerOrganizationResource::make($organization)->response()->setStatusCode(201);
    }
}
