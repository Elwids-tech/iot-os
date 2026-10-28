<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\DeviceAdapters\Models\AdapterDelivery;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\WebhookSecret;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Reports from the webhook receiver (samples, rejections, outcome counts, secret use)
 * and failure reports from tenant runtimes. Each is applied at most once.
 */
final class AdapterReports
{
    public function receiver(array $report): void
    {
        $reportId = $report['report_id'];
        foreach ($report['reports'] as $index => $entry) {
            $adapter = DeviceAdapter::where('uuid', $entry['adapter_uuid'])->whereNotNull('ingest_id')->first();
            if (! $adapter) {
                continue;
            }
            $key = $reportId.':'.$index;
            app(AdapterDiagnostics::class)->addCounts($adapter, $key, now()->toIso8601String(), array_map('intval', $entry['outcomes'] ?? []));
            $at = fn ($value) => Carbon::parse($value);
            foreach (array_slice($entry['rejections'] ?? [], 0, 20) as $n => $rejection) {
                $this->delivery($adapter, $key.':r'.$n, ['kind' => 'rejected', 'reason' => $rejection['reason'], 'source' => 'webhook', 'received_at' => $at($rejection['at']), 'source_address' => $rejection['address'] ?? null,
                    'path' => $rejection['path'] ?? null, 'content_type' => $rejection['content_type'] ?? null, 'size' => (int) ($rejection['size'] ?? 0)]);
            }
            foreach (array_slice($entry['samples'] ?? [], 0, 20) as $n => $sample) {
                $this->delivery($adapter, $key.':s'.$n, ['kind' => 'sample', 'source' => 'webhook', 'received_at' => $at($sample['at']), 'path' => $sample['path'] ?? '', 'content_type' => $sample['content_type'] ?? null,
                    'size' => (int) ($sample['size'] ?? 0), 'delivery_id' => $sample['delivery_id'] ?? null,
                    'input' => ['topic' => $sample['path'] ?? '', 'payload_base64' => $sample['body_base64'] ?? '', 'source' => 'webhook', 'received_at' => $sample['at'],
                        'http' => ['method' => 'POST', 'path' => $sample['path'] ?? '', 'query' => $sample['query'] ?? (object) [], 'contentType' => $sample['content_type'] ?? null, 'headers' => $sample['headers'] ?? (object) [], 'deliveryId' => $sample['delivery_id'] ?? null],
                        ...(($sample['size'] ?? 0) > 65536 ? ['truncated' => true] : [])]]);
            }
            foreach ($entry['secrets_used'] ?? [] as $secret => $usedAt) {
                WebhookSecret::where('device_adapter_id', $adapter->id)->where('uuid', $secret)->where(fn ($q) => $q->whereNull('last_used_at')->orWhere('last_used_at', '<', $at($usedAt)))->update(['last_used_at' => $at($usedAt)]);
            }
            if (($entry['outcomes']['accepted'] ?? 0) > 0) {
                $adapter->update(['health' => [...($adapter->health ?? []), 'last_delivery_at' => now()->toIso8601String()]]);
            }
            $this->trim($adapter);
        }
    }

    public function failure(DeviceAdapter $adapter, array $event): void
    {
        $input = $event['input'] ?? null;
        $this->delivery($adapter, 'runtime:'.$event['report_id'], ['kind' => 'failed', 'reason' => $event['reason'], 'source' => $event['source'] ?? 'mqtt', 'received_at' => Carbon::parse($event['received_at'] ?? now()),
            'path' => $input['http']['path'] ?? ($input['topic'] ?? null), 'content_type' => $input['http']['contentType'] ?? null, 'size' => (int) (strlen(base64_decode($input['payload_base64'] ?? '', true) ?: '')),
            'delivery_id' => $event['delivery_id'] ?? null, 'error' => mb_substr((string) ($event['error'] ?? ''), 0, 300), 'input' => $input]);
        $adapter->update(['diagnostic' => 'A message failed decoding or profile validation. Open Activity to see it and add it as a test sample.']);
        $this->trim($adapter);
    }

    private function delivery(DeviceAdapter $adapter, string $reportId, array $values): void
    {
        DB::table('device_adapter_deliveries')->insertOrIgnore([...array_map(fn ($v) => is_array($v) ? json_encode($v, JSON_UNESCAPED_SLASHES) : $v, $values),
            'uuid' => (string) str()->uuid(), 'organization_id' => $adapter->organization_id, 'device_adapter_id' => $adapter->id, 'report_id' => mb_substr($reportId, 0, 80), 'created_at' => now()]);
    }

    /** Keeps the newest 100 of each kind; older ones go after 7 days anyway (FR-070). */
    private function trim(DeviceAdapter $adapter): void
    {
        foreach (['sample', 'rejected', 'failed'] as $kind) {
            $cutoff = AdapterDelivery::where('device_adapter_id', $adapter->id)->where('kind', $kind)->orderByDesc('received_at')->orderByDesc('id')->skip(100)->value('id');
            if ($cutoff) {
                AdapterDelivery::where('device_adapter_id', $adapter->id)->where('kind', $kind)->where('id', '<=', $cutoff)->delete();
            }
        }
    }
}
