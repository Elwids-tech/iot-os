<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Jobs;

use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\WebhookRoutes;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Pushes an adapter's webhook routing to the receiver through adapter-manager. */
final class SyncWebhookRoute implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $timeout = 60;

    public function __construct(public int $adapterId)
    {
        $this->onQueue('device-adapters')->onConnection(config('adapters.queue_connection', 'database'));
    }

    public function backoff(): array
    {
        return [5, 15, 60, 300];
    }

    public function handle(): void
    {
        if ($adapter = DeviceAdapter::find($this->adapterId)) {
            app(WebhookRoutes::class)->sync($adapter);
        }
    }
}
