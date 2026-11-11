<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Services\DeviceLimit;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Services\DeviceLifecycleService;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * A move that can't finish (spec 031, research R1): a refused stop, a failed re-check or
 * a cutover error. The source ends as it started: each device the move stopped is
 * resumed with its last applied configuration, as the system, keeping the device-limit
 * place it never gave up. A device whose stop the runtime has not answered yet stays in
 * the move until it does, and is resumed then.
 */
final class MoveFailure
{
    public function __construct(private readonly DeviceLifecycleService $lifecycle, private readonly DeviceLimit $limit) {}

    /** Runs inside the caller's transaction, which holds the move's lock. */
    public function fail(DeviceMove $move, string $reason): void
    {
        DB::transaction(function () use ($move, $reason): void {
            if ($move->status !== 'stopping') {
                return;
            }
            $move->update(['status' => 'failed', 'failure_reason' => $reason, 'finished_at' => now()]);
            DeviceMoveDevice::where('device_move_id', $move->id)->whereIn('state', ['waiting', 'failed'])->update(['state' => 'failed', 'outstanding_key' => null]);
            $this->resume($move);
            $source = Organization::withTrashed()->find($move->source_organization_id);
            $target = Organization::withTrashed()->find($move->target_organization_id);
            ActivityLog::record('device_move.failed', $source, null, $move, ['target' => $target?->name, 'reason' => $reason]);
            ActivityLog::record('device_move.failed', $target, null, $move, ['source' => $source?->name, 'reason' => $reason]);
        });
    }

    /**
     * Resumes the devices of a failed move that the runtime has stopped. Called again when
     * a late stop is acknowledged.
     */
    public function resume(DeviceMove $move): void
    {
        foreach (DeviceMoveDevice::where('device_move_id', $move->id)->where('state', 'stopped')->lockForUpdate()->get() as $row) {
            // Out of the move first, so the device takes ordinary requests again.
            $row->update(['state' => 'failed', 'outstanding_key' => null]);
            $device = Device::whereKey($row->predecessor_device_id)->lockForUpdate()->firstOrFail();
            if ($device->lifecycle !== 'deactivated' || ! $row->was_active) {
                continue;
            }
            try {
                // The stop kept the place, so this never meets the device limit (research R4).
                $this->limit->retake($device);
                $this->lifecycle->request($device, ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'expected_generation' => $device->deployment_generation], null);
            } catch (HttpExceptionInterface|ValidationException $exception) {
                Log::warning('A device stopped for a failed move could not be resumed.', ['device_uuid' => $device->uuid, 'reason' => $exception->getMessage()]);
                $device->forceFill(['diagnostic' => 'The move failed and the device could not be resumed: '.$exception->getMessage()])->save();
            }
        }
    }
}
