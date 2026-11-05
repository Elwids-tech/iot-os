<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Actions\PrepareGatewayHealthProfile;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Creates and publishes the organization's gateway health profile once, or returns it (spec 026 US6). */
final class GatewayHealthProfileController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly PrepareGatewayHealthProfile $prepare,
    ) {}

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::CREATE);
        $this->authorization->authorize($request->user(), DeviceProfilePermission::PUBLISH);
        $result = $this->prepare->handle($organization, $request->user());

        return response()->json(['data' => [
            'profile_uuid' => $result['profile']->uuid,
            'artifact_uuid' => $result['artifact']?->uuid,
            'created' => $result['created'],
        ]], $result['created'] ? 201 : 200);
    }
}
