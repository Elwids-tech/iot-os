<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Jobs;

use App\Domain\DeviceAdapters\Models\AdapterOperation;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\AdapterService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

final class DeployAdapter implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 180;

    public function __construct(public int $operationId)
    {
        $this->onQueue('device-adapters')->onConnection(config('adapters.queue_connection', 'database'));
    }

    public function handle(): void
    {
        $operation = AdapterOperation::findOrFail($this->operationId);
        // Duplicate HTTP retries can enqueue the same operation more than once.
        if (! AdapterOperation::whereKey($operation->id)->where('status', 'queued')->update(['status' => 'running'])) {
            return;
        }
        try {
            $adapter = $operation->adapter;
            if ($adapter->desired_revision_uuid !== $operation->revision_uuid || $adapter->status !== 'pending') {
                $operation->update(['status' => 'failed', 'diagnostic' => 'This deployment was superseded.']);

                return;
            }
            app(AdapterService::class)->deploy($operation);
        } catch (\Throwable) {
            $this->failed();
        }
    }

    public function failed(?\Throwable $exception = null): void
    {
        $operation = AdapterOperation::find($this->operationId);
        if (! $operation || $operation->status === 'applied') {
            return;
        }
        $operation->update(['status' => 'failed', 'diagnostic' => 'Deployment could not be confirmed. The saved revision is preserved; inspect runtime health and retry.']);
        DeviceAdapter::whereKey($operation->device_adapter_id)->where('desired_revision_uuid', $operation->revision_uuid)->update(['status' => 'failed', 'diagnostic' => 'The runtime has not confirmed this deployment.']);
    }
}
