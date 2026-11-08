<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use App\Domain\Billing\Services\DeviceLimit;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Records each billing account's devices holding a place as at least this month's peak
 * (spec 029 FR-007). Activations and deactivations keep the peak as they happen; this
 * covers a month in which neither did.
 */
final class RecordDevicePeaks extends Command
{
    protected $signature = 'billing:device-peaks {--now= : Record as of this time instead of now}';

    protected $description = 'Record each billing account\'s active devices as at least this month\'s peak';

    public function handle(DeviceLimit $devices): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $accounts = $devices->recordPeaks($now);
        $this->info("Recorded device peaks for {$accounts} billing accounts.");

        return self::SUCCESS;
    }
}
