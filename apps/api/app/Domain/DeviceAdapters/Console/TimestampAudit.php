<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Console;

use App\Domain\DeviceAdapters\Models\AdapterRevision;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Before releasing spec 020: deployed adapters whose decoders return no observedAt while
 * their devices have a location binding. After the release those bindings report an
 * untrusted time until the decoder returns observedAt (FR-050).
 */
final class TimestampAudit extends Command
{
    protected $signature = 'adapters:timestamp-audit';

    protected $description = 'List deployed adapters whose location readings will become receipt-timed';

    public function handle(): int
    {
        $rows = [];
        foreach (DeviceAdapter::whereNotNull('applied_revision_uuid')->get() as $adapter) {
            $revision = AdapterRevision::where('uuid', $adapter->applied_revision_uuid)->first();
            $outputs = collect($revision?->test_result['results'] ?? [])->pluck('output')->filter();
            if ($outputs->isEmpty() || $outputs->contains(fn ($output) => isset($output['observedAt']))) {
                continue;
            }
            $devices = DB::table('device_location_bindings')->whereIn('device_id', DeviceInstallation::whereIn('device_adapter_candidate_id', $adapter->candidates()->select('id'))->whereNull('ended_at')->select('device_id'))->count();
            if ($devices > 0) {
                $rows[] = [$adapter->organization_id, $adapter->uuid, $adapter->name, $devices];
            }
        }
        $this->table(['Organization', 'Adapter', 'Name', 'Devices with a location binding'], $rows);
        $this->line(count($rows) ? 'These adapters need a decoder that returns observedAt.' : 'No deployed adapter is affected.');

        return self::SUCCESS;
    }
}
