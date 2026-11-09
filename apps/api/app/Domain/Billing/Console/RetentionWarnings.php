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
 * starts to be deleted (spec 029 FR-020), naming the step cleanup takes then. A floor
 * whose end changes nothing needs no warning: the account undid it in the meantime, or
 * a later floor keeps the period until its own end and is warned about then.
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
            $effective = $organization === null ? null : $retention->effective($organization);
            $steps = $effective['pending_reduction']['steps'] ?? [];
            $until = CarbonImmutable::parse((string) $floor->until)->utc();
            // One warning per organization and day, from the period kept before the day's
            // first step to the one after its last: two reductions minutes apart are one change.
            $onDay = array_keys(array_filter($steps, fn (array $step): bool => str_starts_with($step['from'], $until->toDateString())));

            if ($organization?->billingAccount !== null && $onDay !== []) {
                [$first, $last] = [min($onDay), max($onDay)];
                $sent = $notices->send($organization->billingAccount, 'retention_warning', $organization->uuid.':'.$until->toDateString(), new RetentionReducedMail(
                    (string) $organization->billingAccount->uuid,
                    (string) $organization->billingAccount->name,
                    (string) $organization->name,
                    $first === 0 ? (int) $effective['cleanup_days'] : $steps[$first - 1]['days'],
                    $steps[$last]['days'],
                    $steps[$first]['from'],
                    true,
                ));
                $warned += $sent ? 1 : 0;
            }

            DB::table('telemetry_retention_floors')->where('id', $floor->id)->update(['warned_at' => $now]);
        }

        $this->info("Warned owners about {$warned} retention reductions.");

        return self::SUCCESS;
    }
}
