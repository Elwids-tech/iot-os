<?php

declare(strict_types=1);

namespace App\Domain\Overview;

use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

/**
 * One request for the portal home: what needs attention across the fleet.
 * Counts use the same presence rule as DeviceView so the home page and the
 * device list never disagree about which devices are online.
 */
final class OverviewController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly OverviewQuery $overview) {}

    public function __invoke(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return ['data' => $this->overview->summary($organization)];
    }
}
