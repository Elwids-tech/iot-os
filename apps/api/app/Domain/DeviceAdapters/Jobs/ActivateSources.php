<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Jobs;

use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\AdapterService;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Activates up to 200 sources of one data source, each as a single activation would, and
 * redeploys the data source once at the end (spec 038, research R14). Each source gets its
 * own result: activated, already active, or failed with the reason.
 */
final class ActivateSources implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 600;

    /** How long a batch's results stay readable. */
    public const KEEP_SECONDS = 86400;

    /** @param list<array{uuid: string, name: string}> $sources */
    public function __construct(public string $batch, public int $adapterId, public array $sources, public int $actor)
    {
        $this->onQueue('device-adapters')->onConnection(config('adapters.queue_connection', 'database'));
    }

    public static function key(string $batch): string
    {
        return 'adapter-activation:'.$batch;
    }

    /**
     * Where batches are kept: the cache table, which the API and the queue workers share,
     * under a prefix of its own. The default store may be files inside each container,
     * and the cache prefix follows APP_NAME, which the containers need not share.
     */
    public static function store(): Repository
    {
        return Cache::build(['driver' => 'database', 'table' => config('cache.stores.database.table', 'cache'), 'connection' => config('cache.stores.database.connection'), 'prefix' => 'adapter-activation-batches:']);
    }

    public function handle(AdapterService $service): void
    {
        $adapter = DeviceAdapter::findOrFail($this->adapterId);
        $state = self::store()->get(self::key($this->batch)) ?? ['uuid' => $this->batch, 'total' => count($this->sources)];
        $results = [];
        $activated = 0;
        foreach ($this->sources as $source) {
            $candidate = AdapterCandidate::where('device_adapter_id', $adapter->id)->where('uuid', $source['uuid'])->first();
            if (! $candidate) {
                $results[] = ['candidate_uuid' => $source['uuid'], 'outcome' => 'failed', 'message' => 'This source is not part of the data source.', 'device' => null];

                continue;
            }
            $already = $candidate->installation !== null;
            try {
                $installation = $service->activate($candidate, null, $source['name'], $this->actor, false, false);
                $activated += $already ? 0 : 1;
                $results[] = ['candidate_uuid' => $candidate->uuid, 'outcome' => $already ? 'already_active' : 'activated', 'message' => null, 'device' => $installation->device->only(['uuid', 'name'])];
            } catch (HttpExceptionInterface $exception) {
                $results[] = ['candidate_uuid' => $candidate->uuid, 'outcome' => 'failed', 'message' => $exception->getMessage(), 'device' => null];
            }
            self::store()->put(self::key($this->batch), [...$state, 'status' => 'running', 'results' => $results], self::KEEP_SECONDS);
        }
        if ($activated > 0) {
            // One deployment stamps every new installation, instead of one per source.
            try {
                $adapter = $adapter->fresh();
                $operation = $service->operation($adapter, 'deploy', $this->actor, $adapter->applied_revision_uuid);
                DeployAdapter::dispatch($operation->id);
            } catch (HttpExceptionInterface $exception) {
                Log::warning('Activated sources wait for the next deployment of their data source.', ['adapter_uuid' => $adapter->uuid, 'reason' => $exception->getMessage()]);
            }
        }
        self::store()->put(self::key($this->batch), [...$state, 'status' => 'done', 'results' => $results], self::KEEP_SECONDS);
    }

    public function failed(?\Throwable $exception = null): void
    {
        $state = self::store()->get(self::key($this->batch)) ?? ['uuid' => $this->batch, 'total' => count($this->sources), 'results' => []];
        self::store()->put(self::key($this->batch), [...$state, 'status' => 'failed'], self::KEEP_SECONDS);
    }
}
