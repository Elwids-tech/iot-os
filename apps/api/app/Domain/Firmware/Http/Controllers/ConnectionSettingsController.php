<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Firmware\Services\ConnectionSettings;
use App\Domain\Firmware\Services\FirmwareDownloads;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Connection settings alone, to unpack into a starter (spec 027 US3). They carry credentials, so they need Device.manage-connections. */
final class ConnectionSettingsController
{
    public function __construct(
        private readonly DeviceAuthorization $authorization,
        private readonly ConnectionSettings $settings,
        private readonly FirmwareDownloads $downloads,
    ) {}

    public function device(Request $request, Organization $organization, Device $device): JsonResponse
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $device);
        $files = $this->settings->device($device);
        DeviceAudit::record('device.connection-settings.downloaded', $organization->id, $request->user()->id, $device->uuid);

        return $this->downloads->response($device->code.'-connection-settings.zip', null, $files);
    }

    public function gateway(Request $request, Organization $organization, SparkplugGateway $gateway): JsonResponse
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $gateway);
        $files = $this->settings->gateway($gateway);
        DeviceAudit::record('gateway.connection-settings.downloaded', $organization->id, $request->user()->id, $gateway->uuid);

        return $this->downloads->response($gateway->edge_node_id.'-gateway-connection-settings.zip', null, $files);
    }
}
