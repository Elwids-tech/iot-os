<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use App\Domain\Billing\Mail\RetentionReducedMail;
use App\Domain\Billing\Services\Notices;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Warns billing account owners 7 days before a retention floor ends and older history
 * starts to be deleted (spec 029 FR-020). A floor the account undid in the meantime (its
 * retention is back at or above the floor) needs no warning.
 */
final class RetentionWarnings extends Command
{
    protected $signature = 'billing:retention-warnings {--now= : Warn as of this time instead of now}';

    protected $description = 'Warn owners 7 days before a shortened telemetry retention takes effect';

    public function handle(RetentionService $retention, Notices $notices): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $floors = DB::table('telemetry_retention_floors')
            ->whereNull('warned_at')
            ->where('until', '>', $now)
            ->where('until', '<=', $now->addDays(7))
            ->orderBy('id')
            ->get();
        $warned = 0;

        foreach ($floors as $floor) {
            $organization = Organization::query()->with('billingAccount')->find($floor->organization_id);
            $days = $organization === null ? null : $retention->effective($organization)['days'];

            if ($organization?->billingAccount !== null && $days < $floor->days) {
                $until = CarbonImmutable::parse((string) $floor->until)->utc();
                $notices->send($organization->billingAccount, 'retention_warning', $organization->uuid.':'.$until->toDateString(), new RetentionReducedMail(
                    (string) $organization->billingAccount->uuid,
                    (string) $organization->billingAccount->name,
                    (string) $organization->name,
                    (int) $floor->days,
                    (int) $days,
                    $until->toIso8601ZuluString(),
                    true,
                ));
                $warned++;
            }

            DB::table('telemetry_retention_floors')->where('id', $floor->id)->update(['warned_at' => $now]);
        }

        $this->info("Warned owners about {$warned} retention reductions.");

        return self::SUCCESS;
    }
}
