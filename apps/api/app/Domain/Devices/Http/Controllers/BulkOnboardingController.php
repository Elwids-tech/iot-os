<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Http\Requests\StoreBulkOnboardingRequest;
use App\Domain\Devices\Http\Resources\BulkOnboardingResource;
use App\Domain\Devices\Models\DeviceBulkOnboarding;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\BulkOnboarding;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Bulk onboarding of a gateway's discovered sources with one published profile
 * (spec 026 US5): people pick the sources; nothing is onboarded automatically.
 */
final class BulkOnboardingController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly BulkOnboarding $bulk) {}

    public function store(StoreBulkOnboardingRequest $request, Organization $organization, SparkplugGateway $gateway): JsonResponse
    {
        $run = $this->bulk->start($organization, $gateway, $request->validated(), $request->user()->id);

        return (new BulkOnboardingResource($run->fresh()))->response()->setStatusCode(202);
    }

    public function show(Request $request, Organization $organization, DeviceBulkOnboarding $run): BulkOnboardingResource
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $run);
        // `data.next_cursor` of the previous page of items.
        $request->validate(['cursor' => ['sometimes', 'string', 'max:512']]);

        return new BulkOnboardingResource($run);
    }

    public function retry(Request $request, Organization $organization, DeviceBulkOnboarding $run): JsonResponse
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $run);
        $this->authorization->authorize($request->user(), DevicePermission::ACTIVATE, $organization);

        return (new BulkOnboardingResource($this->bulk->retry($run, $request->user()->id)->fresh()))->response()->setStatusCode(202);
    }
}
