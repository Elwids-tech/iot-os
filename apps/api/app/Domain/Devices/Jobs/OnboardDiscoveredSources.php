<?php

declare(strict_types=1);

namespace App\Domain\Devices\Jobs;

use App\Domain\Devices\Enums\BulkOnboardingItemStatus;
use App\Domain\Devices\Enums\BulkOnboardingStatus;
use App\Domain\Devices\Models\DeviceBulkOnboarding;
use App\Domain\Devices\Services\BulkOnboarding;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Works through a bulk onboarding run (spec 026 R18), at most {@see self::CHUNK} items
 * per job: the release's default worker stops a job after 60 s, so each job hands the
 * rest to the next one. Items are never retried automatically.
 */
final class OnboardDiscoveredSources implements ShouldQueue
{
    use Queueable;

    public const CHUNK = 50;

    public int $tries = 1;

    public int $timeout = 60;

    public function __construct(public int $runId, public bool $continuation = false)
    {
        $this->onConnection(config('devices.queue_connection', 'database'))->onQueue('default');
    }

    public function handle(BulkOnboarding $bulk): void
    {
        $run = DeviceBulkOnboarding::findOrFail($this->runId);
        // A run starts once: a duplicate dispatch finds it already running and stops here.
        $from = $this->continuation ? BulkOnboardingStatus::Running : BulkOnboardingStatus::Queued;
        if (! DeviceBulkOnboarding::whereKey($run->id)->where('status', $from->value)->update(['status' => BulkOnboardingStatus::Running->value, 'started_at' => $run->started_at ?? now()])) {
            return;
        }
        try {
            $run->refresh();
            $items = $run->items()->where('status', BulkOnboardingItemStatus::Pending->value)->orderBy('id')->limit(self::CHUNK)->pluck('id');
            foreach ($items as $item) {
                $bulk->onboard($run, $item);
            }
            if ($run->items()->where('status', BulkOnboardingItemStatus::Pending->value)->exists()) {
                self::dispatch($run->id, true);

                return;
            }
            $bulk->finish($run);
        } catch (\Throwable $exception) {
            report($exception);
            $this->failed($exception);
        }
    }

    /** The items no job reached are marked failed, then the run rolls up as usual. */
    public function failed(?\Throwable $exception = null): void
    {
        $run = DeviceBulkOnboarding::find($this->runId);
        if (! $run || $run->status->finished()) {
            return;
        }
        $bulk = app(BulkOnboarding::class);
        $bulk->abandon($run);
        $run->forceFill(['status' => BulkOnboardingStatus::Running])->save();
        $bulk->finish($run);
    }
}
