<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\UpdateBillingSettingsRequest;
use App\Domain\Billing\Services\BillingSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * The operator's billing details and number prefixes (spec 029 FR-029). `currency` is
 * the deployment's and read-only; a stale `revision` answers 409.
 */
final class PlatformBillingSettingsController
{
    public function __construct(private readonly BillingSettings $settings) {}

    public function show(): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return response()->json(['data' => $this->settings->get()]);
    }

    public function update(UpdateBillingSettingsRequest $request): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return response()->json(['data' => $this->settings->update(
            $request->safe()->except('revision'),
            $request->integer('revision'),
            $request->user(),
        )]);
    }
}
