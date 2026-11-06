<?php

declare(strict_types=1);

namespace App\Domain\Connectivity\Http\Controllers;

use App\Domain\Connectivity\Services\ConnectivitySettings;
use App\Domain\Connectivity\Services\ConnectivityState;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

/**
 * A device's offline-alert settings and what the runtime's tracker knows about it
 * (spec 018). Read-only until pull request 3 lets people change the settings.
 */
final class DeviceConnectivityController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly ConnectivitySettings $settings, private readonly ConnectivityState $state) {}

    public function show(Request $request, Organization $organization, Device $device): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $adapter = $this->settings->adapter($device);

        return ['data' => [
            'effective' => $this->settings->effective($adapter),
            'inherited_from' => $this->settings->inheritedFrom($adapter),
            'style_locked' => $adapter ? ['reason' => 'adapter'] : null,
            'state' => $this->state->of($organization, $device),
            'alert' => DeviceView::offlineAlert($device),
        ]];
    }
}
