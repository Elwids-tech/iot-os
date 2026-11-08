<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Billing\Http\Resources\OrganizationUsageResource;
use App\Domain\Billing\Services\OrganizationUsage;
use App\Domain\Billing\Services\Usage;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * This month's usage as a manager of the organization sees it (spec 028 FR-022, spec 029
 * FR-024): members who may manage devices see the organization's own counts and what is
 * left on its billing account, never the account's name, its other organizations or
 * prices. Others get 403. Without an SMS provider on the deployment, SMS is left out.
 */
final class OrganizationUsageController
{
    public function __construct(private readonly Usage $usage, private readonly DeviceAuthorization $authorization) {}

    public function show(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);

        return OrganizationUsageResource::collection(array_map(
            fn (OrganizationUsage $usage): OrganizationUsageResource => new OrganizationUsageResource($usage),
            $this->usage->forOrganization($organization, CarbonImmutable::now(), withSms: Usage::smsAvailable()),
        ));
    }
}
