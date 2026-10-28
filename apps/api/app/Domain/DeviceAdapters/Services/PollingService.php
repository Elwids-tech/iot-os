<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\DeviceAdapters\Jobs\DeployAdapter;
use App\Domain\DeviceAdapters\Models\AdapterOperation;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\PollRun;
use App\Domain\Devices\Services\DeviceAudit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpKernel\Exception\HttpException;

/** HTTP polling sources: Fetch now, cursors and run reports (spec 020, FR-030 to FR-040). */
final class PollingService
{
    /**
     * Runs one request with the saved draft and credentials, without moving the cursor
     * or publishing. People and the onboarding assistant share the limit (FR-039).
     */
    public function fetch(DeviceAdapter $adapter): array
    {
        abort_unless(($adapter->source['type'] ?? null) === 'poll', 422, 'Fetch now is for HTTP polling sources.');
        if (RateLimiter::tooManyAttempts('adapter-fetch:'.$adapter->id, 6)) {
            $wait = RateLimiter::availableIn('adapter-fetch:'.$adapter->id);
            throw new HttpException(429, "Fetch now is limited to 6 a minute. Try again in {$wait} seconds.", null, ['Retry-After' => (string) $wait]);
        }
        RateLimiter::hit('adapter-fetch:'.$adapter->id, 60);
        $source = $adapter->source;
        $cursor = $adapter->poll_state['cursor']['value'] ?? null;
        if ($cursor === null && $source['cursor']['kind'] !== 'token') {
            $start = now()->subSeconds((int) ($source['initial_lookback_seconds'] ?? 3600));
            $cursor = match ($source['time_format'] ?? 'iso') {
                'epoch_s' => (string) $start->getTimestamp(),
                'epoch_ms' => (string) $start->getTimestampMs(),
                default => $start->toIso8601ZuluString('millisecond'),
            };
        }
        $result = app(AdapterManager::class)->request('/poll-test', ['source' => [...$source, ...array_intersect_key($adapter->secrets ?? [], array_flip(['api_key', 'token', 'username', 'password', 'ca_certificate']))], 'cursor' => $cursor]);
        $result['headers'] = (object) ($result['headers'] ?? []);
        $ok = ($result['status'] ?? 0) >= 200 && ($result['status'] ?? 0) < 300 && blank($result['error'] ?? null);
        $adapter->update(['health' => [...($adapter->health ?? []), 'last_fetch' => ['at' => now()->toIso8601String(), 'ok' => $ok, 'records' => (int) ($result['record_count'] ?? 0), 'error' => $ok ? null : mb_substr((string) ($result['error'] ?? 'HTTP '.($result['status'] ?? '?')), 0, 200)]]]);

        return $result;
    }

    /** Where a first deployment starts, at most 30 days back (FR-033). */
    public function firstDeployment(DeviceAdapter $adapter, ?string $startAt): void
    {
        if (($adapter->source['type'] ?? null) !== 'poll' || $adapter->cursor_generation > 0) {
            return;
        }
        $start = $startAt ? Carbon::parse($startAt) : now()->subSeconds((int) ($adapter->source['initial_lookback_seconds'] ?? 3600));
        abort_if($start->lt(now()->subDays(30)->subMinute()) || $start->gt(now()->addMinute()), 422, 'Start polling at most 30 days back.');
        $adapter->update(['cursor_generation' => 1, 'cursor_start' => $start]);
    }

    /** Resets the cursor by redeploying the applied revision with a new generation. */
    public function reset(DeviceAdapter $adapter, string $startAt, int $actor, string $requestUuid): AdapterOperation
    {
        abort_unless(($adapter->source['type'] ?? null) === 'poll' && $adapter->applied_revision_uuid, 422, 'Deploy the polling adapter before resetting its cursor.');
        $start = Carbon::parse($startAt);
        abort_if($start->lt(now()->subDays(30)->subMinute()) || $start->gt(now()->addMinute()), 422, 'Reset the cursor to a time in the last 30 days.');
        $operation = DB::transaction(function () use ($adapter, $start, $actor, $requestUuid) {
            if ($existing = AdapterOperation::where('uuid', $requestUuid)->first()) {
                abort_unless($existing->device_adapter_id === $adapter->id && $existing->created_by === $actor, 404);

                return $existing;
            }
            $locked = DeviceAdapter::whereKey($adapter->id)->lockForUpdate()->firstOrFail();
            $locked->update(['cursor_generation' => $locked->cursor_generation + 1, 'cursor_start' => $start, 'poll_state' => [...($locked->poll_state ?? []), 'cursor' => null]]);
            DeviceAudit::record('device.adapter.cursor.reset', $locked->organization_id, $actor, $locked->uuid, ['start_at' => $start->toIso8601String(), 'generation' => $locked->cursor_generation]);

            return app(AdapterService::class)->operation($locked->fresh(), 'deploy', $actor, $locked->applied_revision_uuid, $requestUuid);
        });
        if ($operation->status === 'queued') {
            DeployAdapter::dispatch($operation->id)->afterCommit();
        }

        return $operation;
    }

    /** Restarts a stopped poller from its last committed cursor. */
    public function resume(DeviceAdapter $adapter, int $actor, string $requestUuid): AdapterOperation
    {
        abort_unless(($adapter->poll_state['state'] ?? null) === 'stopped' && $adapter->applied_revision_uuid, 422, 'Polling is not stopped.');
        $operation = app(AdapterService::class)->operation($adapter, 'deploy', $actor, $adapter->applied_revision_uuid, $requestUuid);
        if ($operation->status === 'queued') {
            DeployAdapter::dispatch($operation->id)->afterCommit();
        }
        DeviceAudit::record('device.adapter.polling.resumed', $adapter->organization_id, $actor, $adapter->uuid, ['operation_uuid' => $operation->uuid]);

        return $operation;
    }

    /** Records a run reported by the tenant runtime, once per run id. */
    public function record(DeviceAdapter $adapter, array $run): void
    {
        $time = fn ($value) => $value ? Carbon::parse($value) : null;
        PollRun::updateOrCreate(['device_adapter_id' => $adapter->id, 'run_id' => $run['run_id']], [
            'organization_id' => $adapter->organization_id, 'revision_uuid' => $run['revision_uuid'] ?? null, 'started_at' => $time($run['started_at']), 'finished_at' => $time($run['finished_at'] ?? null),
            'outcome' => $run['outcome'], 'http_status' => $run['http_status'] ?? null, 'pages' => $run['pages'] ?? 0, 'records' => $run['records'] ?? 0, 'published' => $run['published'] ?? 0,
            'failed' => $run['failed'] ?? 0, 'duplicates' => $run['duplicates'] ?? 0, 'cursor_before' => $run['cursor_before'] ?? null, 'cursor_after' => $run['cursor_after'] ?? null,
            'error' => isset($run['error']) ? mb_substr((string) $run['error'], 0, 300) : null, 'next_attempt_at' => $time($run['next_attempt_at'] ?? null),
        ]);
        $adapter->update(['poll_state' => ['state' => $run['state'] ?? 'polling', 'reason' => $run['reason'] ?? null, 'next_run_at' => $run['next_attempt_at'] ?? null, 'last_run_at' => $run['finished_at'] ?? $run['started_at'],
            'cursor' => array_key_exists('cursor_after', $run) ? ['value' => $run['cursor_after'], 'kind' => $adapter->source['cursor']['kind'] ?? null, 'committed_at' => $run['committed_at'] ?? null, 'run_id' => $run['run_id']] : ($adapter->poll_state['cursor'] ?? null)]]);
    }
}
