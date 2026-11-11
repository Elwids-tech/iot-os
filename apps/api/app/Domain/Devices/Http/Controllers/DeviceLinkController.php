<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceLink;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The link a move leaves between a device and its successor (spec 031, contract
 * § History). The source decides whether the target keeps reading the readings from
 * before the move.
 */
final class DeviceLinkController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    /**
     * Stops sharing a moved device's readings from before the move with the organization
     * it moved to (FR-052). Only on the archived predecessor, by a member of its
     * organization holding `Device.move`. Sharing can't be turned back on; stopping again
     * changes nothing. Answers with the device's link.
     */
    public function history(Request $request, Organization $organization, Device $device): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MOVE, $organization, $device);
        $request->validate(['enabled' => ['required', 'boolean', 'declined']], ['enabled.declined' => 'Sharing can only be stopped. It can’t be turned back on.']);
        abort_unless(DeviceLink::where('predecessor_device_id', $device->id)->exists(), 404);

        DB::transaction(function () use ($request, $organization, $device): void {
            $link = DeviceLink::where('predecessor_device_id', $device->id)->lockForUpdate()->firstOrFail();
            abort_unless($link->history_included, 409, 'The readings from before the move aren’t shared.');
            if ($link->history_stopped_at !== null) {
                return;
            }
            $link->forceFill(['history_stopped_at' => now(), 'history_stopped_by' => $request->user()->id, 'history_stopped_reason' => 'stopped'])->save();
            $target = Organization::withTrashed()->find($link->target_organization_id);
            ActivityLog::record('device_link.history_stopped', $organization, $request->user(), $device, ['target' => $target?->name]);
            if ($target && ! $target->trashed()) {
                ActivityLog::record('device_link.history_stopped', $target, $request->user(), Device::find($link->successor_device_id), ['source' => $organization->name]);
            }
        });

        return ['data' => DeviceView::link($device->fresh())];
    }
}
