<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\DeviceAdapters\Models\AdapterDelivery;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceAdapters\Models\WebhookSecret;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * What a person needs to see when data is not arriving (spec 020, FR-070 to FR-074),
 * and the setup checklist that tells them what to do next (FR-100).
 */
final class AdapterDiagnostics
{
    public const OUTCOMES = ['accepted', 'unauthenticated', 'stale_signature', 'too_large', 'rate_limited', 'paused', 'broker_unavailable', 'bad_request', 'decoded', 'decode_failed', 'validation_failed', 'duplicate', 'historical'];

    private const REJECTIONS = ['unauthenticated', 'stale_signature', 'too_large', 'rate_limited', 'paused', 'broker_unavailable', 'bad_request'];

    public function summary(DeviceAdapter $adapter): array
    {
        $webhook = $this->webhook($adapter);
        $polling = $this->polling($adapter);

        return ['webhook' => $webhook, 'polling' => $polling, 'source_state' => $this->sourceState($adapter, $webhook, $polling), 'checklist' => $this->checklist($adapter, $webhook, $polling)];
    }

    /** @return array<string, array<string, int>> */
    public function counts(DeviceAdapter $adapter): array
    {
        $rows = DB::table('device_adapter_outcome_counts')->where('device_adapter_id', $adapter->id)->where('bucket', '>=', now()->subDays(7)->startOfHour())
            ->get(['bucket', 'outcome', 'count']);
        $day = now()->subDay()->startOfHour();
        $result = ['24h' => [], '7d' => []];
        foreach ($rows as $row) {
            $result['7d'][$row->outcome] = ($result['7d'][$row->outcome] ?? 0) + $row->count;
            if (Carbon::parse($row->bucket)->gte($day)) {
                $result['24h'][$row->outcome] = ($result['24h'][$row->outcome] ?? 0) + $row->count;
            }
        }

        return $result;
    }

    public function webhook(DeviceAdapter $adapter): array
    {
        $routes = app(WebhookRoutes::class);
        $isWebhook = ($adapter->source['type'] ?? null) === 'webhook';
        if (! $isWebhook) {
            return ['available' => $routes->available(), 'ingest_url' => null, 'state' => null, 'last_delivery_at' => null, 'active_secrets' => 0];
        }
        $last = $adapter->health['last_delivery_at'] ?? null;
        $rejected = AdapterDelivery::where('device_adapter_id', $adapter->id)->where('kind', 'rejected')->where('received_at', '>=', now()->subHour())->exists();
        $state = match (true) {
            $rejected => 'rejecting',
            $last === null => 'no_deliveries',
            Carbon::parse($last)->lt(now()->subDay()) => 'idle',
            default => 'receiving',
        };

        return ['available' => $routes->available(), 'ingest_url' => $routes->url($adapter), 'state' => $state, 'last_delivery_at' => $last, 'active_secrets' => WebhookSecret::where('device_adapter_id', $adapter->id)->active()->count()];
    }

    public function polling(DeviceAdapter $adapter): ?array
    {
        if (($adapter->source['type'] ?? null) !== 'poll') {
            return null;
        }
        $state = $adapter->poll_state ?? [];
        $applied = $adapter->applied_revision_uuid && $adapter->revisions()->where('uuid', $adapter->applied_revision_uuid)->first()?->definition['source']['type'] === 'poll';

        return ['state' => ! $applied ? 'not_deployed' : ($adapter->status === 'paused' ? 'stopped' : ($state['state'] ?? 'polling')), 'reason' => $adapter->status === 'paused' ? 'Paused' : ($state['reason'] ?? null),
            'next_run_at' => $state['next_run_at'] ?? null, 'last_run_at' => $state['last_run_at'] ?? null, 'cursor' => $state['cursor'] ?? null];
    }

    public function sourceState(DeviceAdapter $adapter, ?array $webhook = null, ?array $polling = null): array
    {
        $type = $adapter->source['type'] ?? 'platform';
        if ($type === 'webhook') {
            $webhook ??= $this->webhook($adapter);
            $labels = ['no_deliveries' => 'No deliveries yet', 'receiving' => 'Receiving', 'rejecting' => 'Rejecting', 'idle' => 'No deliveries in 24 hours'];

            return ['state' => $webhook['state'], 'label' => $labels[$webhook['state']], 'detail' => $webhook['last_delivery_at'] ? 'Last delivery '.Carbon::parse($webhook['last_delivery_at'])->diffForHumans() : null];
        }
        if ($type === 'poll') {
            $polling ??= $this->polling($adapter);
            $label = ['not_deployed' => 'Not deployed', 'polling' => 'Polling', 'retrying' => 'Retrying', 'stopped' => 'Stopped'][$polling['state']] ?? 'Polling';

            return ['state' => $polling['state'], 'label' => $polling['state'] === 'stopped' && $polling['reason'] ? 'Stopped: '.lcfirst($polling['reason']) : $label,
                'detail' => $polling['state'] === 'retrying' && $polling['next_run_at'] ? 'Next attempt '.Carbon::parse($polling['next_run_at'])->diffForHumans() : null];
        }
        $connected = ($adapter->health['source_connected'] ?? false) && Carbon::parse($adapter->health['checked_at'] ?? '2000-01-01')->gt(now()->subSeconds(30));
        if (! $adapter->applied_revision_uuid) {
            return ['state' => 'not_deployed', 'label' => 'Not deployed', 'detail' => null];
        }

        return ['state' => $connected ? 'connected' : 'disconnected', 'label' => $connected ? 'Broker connected' : 'Broker disconnected', 'detail' => null];
    }

    /** @return list<array{step: string, state: string, detail: ?string}> */
    public function checklist(DeviceAdapter $adapter, ?array $webhook = null, ?array $polling = null): array
    {
        $type = $adapter->source['type'] ?? 'platform';
        $current = $adapter->revisions()->where('revision', $adapter->draft_revision)->first();
        $test = $current?->test_result;
        $saved = $adapter->secrets ?? [];
        $connect = match ($type) {
            'webhook' => ($webhook ??= $this->webhook($adapter))['active_secrets'] === 0 ? ['todo', 'Create a secret and paste it into the vendor cloud'] : ($webhook['last_delivery_at'] ? ['done', 'Deliveries arriving'] : ['waiting', 'Waiting for the first delivery']),
            'poll' => $this->pollConnect($adapter, $saved),
            'vendor' => filled($adapter->source['url'] ?? null) ? ['done', $adapter->source['url']] : ['todo', null],
            default => ['done', 'Devices publish to the tenant broker'],
        };
        $samples = AdapterDelivery::where('device_adapter_id', $adapter->id)->whereIn('kind', ['sample', 'failed'])->exists() || $adapter->candidates()->exists();
        $fixtures = count($adapter->fixtures ?? []);
        $decoderTested = $test && collect($test['results'] ?? [])->contains(fn ($r) => isset($r['output']));
        $deployed = $adapter->applied_revision_uuid && $adapter->applied_revision_uuid === $current?->uuid && $adapter->status === 'running';
        $activated = DeviceInstallation::whereIn('device_adapter_candidate_id', $adapter->candidates()->select('id'))->whereNull('ended_at')->count();
        $waiting = $adapter->candidates()->where('status', 'discovered')->count();

        return [
            ['step' => 'type', 'state' => 'done', 'detail' => $adapter->artifact->profile->name],
            ['step' => 'connect', 'state' => $connect[0], 'detail' => $connect[1]],
            ['step' => 'samples', 'state' => $fixtures > 0 ? 'done' : ($samples ? 'waiting' : 'todo'), 'detail' => $fixtures > 0 ? $fixtures.' '.str('test sample')->plural($fixtures) : ($samples ? 'Samples captured; add them as fixtures' : null)],
            ['step' => 'decoder', 'state' => $test && ! ($test['valid'] ?? false) ? 'attention' : ($decoderTested ? 'done' : 'todo'), 'detail' => $test && ! ($test['valid'] ?? false) ? 'The last test failed' : null],
            ['step' => 'deploy', 'state' => $deployed ? 'done' : ($adapter->status === 'pending' ? 'waiting' : ($adapter->status === 'failed' ? 'attention' : 'todo')), 'detail' => $deployed ? 'Revision '.$current->revision.' running' : ($adapter->status === 'failed' ? $adapter->diagnostic : null)],
            ['step' => 'activate', 'state' => $activated > 0 ? 'done' : ($waiting > 0 ? 'waiting' : 'todo'), 'detail' => $activated > 0 ? $activated.' '.str('device')->plural($activated).' active' : ($waiting > 0 ? $waiting.' discovered '.str('source')->plural($waiting).' waiting' : null)],
        ];
    }

    private function pollConnect(DeviceAdapter $adapter, array $saved): array
    {
        $placement = $adapter->source['credentials']['placement'] ?? 'none';
        $needs = ['header' => ['api_key'], 'query' => ['api_key'], 'bearer' => ['token'], 'basic' => ['username', 'password'], 'none' => []][$placement] ?? [];
        foreach ($needs as $key) {
            if (blank($saved[$key] ?? null)) {
                return ['todo', 'Enter the vendor API credentials'];
            }
        }
        $polling = $this->polling($adapter);
        if ($polling['state'] === 'stopped') {
            return ['attention', 'Polling stopped: '.lcfirst((string) ($polling['reason'] ?? 'see Activity'))];
        }
        if ($polling['state'] === 'retrying') {
            return ['waiting', 'Retrying the vendor API'];
        }
        $fetch = $adapter->health['last_fetch'] ?? null;
        if (! $fetch) {
            return ['todo', 'Run Fetch now to check the request'];
        }

        return ($fetch['ok'] ?? false) ? ['done', 'Fetch now returned '.$fetch['records'].' '.str('record')->plural($fetch['records'])] : ['attention', 'Last Fetch now failed: '.$fetch['error']];
    }

    /** Applies a runtime or receiver count report once (report ids are remembered). */
    public function addCounts(DeviceAdapter $adapter, string $reportId, string $bucket, array $counts): void
    {
        DB::transaction(function () use ($adapter, $reportId, $bucket, $counts) {
            if (! DB::table('device_adapter_reports')->insertOrIgnore(['report_id' => $reportId, 'created_at' => now()])) {
                return;
            }
            foreach ($counts as $outcome => $count) {
                if (! in_array($outcome, self::OUTCOMES, true) || ! is_int($count) || $count <= 0) {
                    continue;
                }
                $key = ['device_adapter_id' => $adapter->id, 'bucket' => Carbon::parse($bucket)->startOfHour(), 'outcome' => $outcome];
                $updated = DB::table('device_adapter_outcome_counts')->where($key)->increment('count', min($count, 1000000));
                if (! $updated) {
                    DB::table('device_adapter_outcome_counts')->insertOrIgnore([...$key, 'organization_id' => $adapter->organization_id, 'count' => min($count, 1000000)]) || DB::table('device_adapter_outcome_counts')->where($key)->increment('count', min($count, 1000000));
                }
            }
        });
    }

    public static function rejection(string $reason): bool
    {
        return in_array($reason, self::REJECTIONS, true);
    }
}
