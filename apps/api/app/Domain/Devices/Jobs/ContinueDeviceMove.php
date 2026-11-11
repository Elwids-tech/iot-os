<?php

declare(strict_types=1);

namespace App\Domain\Devices\Jobs;

use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Services\Moves\MoveCutover;
use App\Domain\Devices\Services\Moves\MoveFailure;
use App\Domain\Shared\Models\Organization;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Takes a move on after the runtime answered one of its stops (spec 031, research R10).
 * Idempotent: it locks the move and does nothing until every device has stopped. A
 * refused stop fails the move, and so does a cutover that can't complete; a failed move
 * resumes devices whose late stop arrives afterwards.
 */
final class ContinueDeviceMove implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public int $moveId)
    {
        $this->onConnection(config('devices.queue_connection', 'database'))->onQueue('default');
    }

    public function handle(MoveCutover $cutover, MoveFailure $failure): void
    {
        $move = DeviceMove::find($this->moveId);
        if (! $move) {
            return;
        }
        if ($move->status === 'failed') {
            DB::transaction(function () use ($move, $failure): void {
                $failure->resume(DeviceMove::whereKey($move->id)->lockForUpdate()->firstOrFail());
            });

            return;
        }
        $refused = DeviceMoveDevice::where('device_move_id', $move->id)->where('state', 'failed')->with('predecessor:id,name,diagnostic')->first();
        if ($move->status === 'stopping' && $refused) {
            $this->fail($move, $failure, 'The runtime could not stop '.$refused->predecessor->name.($refused->predecessor->diagnostic ? ': '.$refused->predecessor->diagnostic : '.'));

            return;
        }
        try {
            $cutover->run($move);
        } catch (Throwable $exception) {
            report($exception);
            $this->fail($move, $failure, 'The move could not be completed, so nothing moved. Try it again.');
        }
    }

    private function fail(DeviceMove $move, MoveFailure $failure, string $reason): void
    {
        DB::transaction(function () use ($move, $failure, $reason): void {
            Organization::whereIn('id', [$move->source_organization_id, $move->target_organization_id])->orderBy('id')->lockForUpdate()->get();
            $failure->fail(DeviceMove::whereKey($move->id)->lockForUpdate()->firstOrFail(), $reason);
        });
    }
}
