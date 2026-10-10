<?php

declare(strict_types=1);

namespace App\Domain\Overview;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Models\DiscoveryCandidate;
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
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function __invoke(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $fresh = now()->subSeconds(20);
        $devices = Device::where('organization_id', $organization->id)->whereNotIn('lifecycle', ['archived'])
            ->selectRaw("count(*) FILTER (WHERE lifecycle = 'active') AS active")
            ->selectRaw("count(*) FILTER (WHERE lifecycle = 'active' AND presence = 'online' AND runtime_seen_at >= ?) AS online", [$fresh])
            ->selectRaw("count(*) FILTER (WHERE lifecycle = 'active' AND presence = 'offline') AS offline")
            ->selectRaw("count(*) FILTER (WHERE lifecycle = 'active' AND (presence = 'unknown' OR (presence = 'online' AND (runtime_seen_at IS NULL OR runtime_seen_at < ?)))) AS unknown", [$fresh])
            ->selectRaw("count(*) FILTER (WHERE lifecycle = 'registered') AS registered")
            ->selectRaw("count(*) FILTER (WHERE lifecycle = 'deactivated') AS deactivated")
            ->selectRaw("count(*) FILTER (WHERE lifecycle = 'active' AND (last_seen_at IS NULL OR last_seen_at < ?)) AS silent", [now()->subDay()])
            ->first();
        $alerts = Alert::where('organization_id', $organization->id);
        $workflows = Workflow::where('organization_id', $organization->id)->where('workflow->schema_version', 'automation-workflow.v2');
        $activeAlerts = (clone $alerts)->whereNull('cleared_at')->with(['workflow:id,name', 'deployment'])->latest('activated_at')->limit(5)->get();
        $alertDevice = fn (Alert $alert) => $alert->deployment->definition['binding']['device_uuid'] ?? $alert->deployment->definition['bindings'][0]['device_uuid'] ?? null;
        $alertDevices = Device::where('organization_id', $organization->id)->whereIn('uuid', $activeAlerts->map($alertDevice)->filter())->pluck('name', 'uuid');
        $commands = DeviceCommand::whereIn('device_id', Device::where('organization_id', $organization->id)->select('id'))->latest('id')->limit(5)->get();
        $commandDevices = Device::whereIn('id', $commands->pluck('device_id'))->pluck('name', 'id');

        return ['data' => [
            'devices' => collect(['active', 'online', 'offline', 'unknown', 'registered', 'deactivated', 'silent'])->mapWithKeys(fn ($key) => [$key => (int) $devices->{$key}]),
            'alerts' => [
                'active' => (clone $alerts)->whereNull('cleared_at')->count(),
                'active_unacknowledged' => (clone $alerts)->whereNull('cleared_at')->whereNull('acknowledged_at')->count(),
                'unacknowledged' => (clone $alerts)->whereNull('acknowledged_at')->count(),
                'last_24_hours' => (clone $alerts)->where('activated_at', '>=', now()->subDay())->count(),
                'latest_active' => $activeAlerts->map(fn (Alert $alert) => [
                    'uuid' => $alert->uuid,
                    'workflow_name' => $alert->workflow?->name,
                    'device_name' => $alertDevices[$alertDevice($alert)] ?? null,
                    'activated_at' => $alert->activated_at?->toIso8601String(),
                    'acknowledged' => $alert->acknowledged_at !== null,
                ])->values(),
            ],
            'automations' => (clone $workflows)->selectRaw('deployment_status, count(*) AS count')->groupBy('deployment_status')->pluck('count', 'deployment_status')->map(fn ($count) => (int) $count),
            'discovery' => ['pending' => DiscoveryCandidate::where('organization_id', $organization->id)->where('status', 'pending')->count()],
            'commands' => [
                'uncertain' => DeviceCommand::whereIn('device_id', Device::where('organization_id', $organization->id)->select('id'))->where('status', 'uncertain')->count(),
                'recent' => $commands->map(fn (DeviceCommand $command) => [
                    'uuid' => $command->uuid,
                    'device_name' => $commandDevices[$command->device_id] ?? null,
                    'status' => $command->status,
                    'created_at' => $command->created_at?->toIso8601String(),
                ])->values(),
            ],
        ]];
    }
}
