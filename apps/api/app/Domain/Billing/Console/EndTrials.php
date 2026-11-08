<?php

declare(strict_types=1);

namespace App\Domain\Billing\Console;

use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Mail\TrialMail;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Services\Notices;
use App\Domain\Billing\Services\Trials;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Ends limited trials whose end date has passed (spec 029 FR-050), then reminds the
 * owners of trials ending within 7 days and within 1 day (FR-049, SC-008). Each reminder
 * goes once per trial and end date, so extending a trial reminds again before its new
 * end, and a trial started with less than 7 days left gets only the reminders still due.
 */
final class EndTrials extends Command
{
    protected $signature = 'billing:end-trials {--now= : Run as of this time instead of now}';

    protected $description = 'End trials that reached their end date, and remind owners 7 days and 1 day before a trial ends';

    public function handle(Trials $trials, Notices $notices): int
    {
        $now = $this->option('now') ? CarbonImmutable::parse((string) $this->option('now')) : CarbonImmutable::now();
        $ended = $trials->endDue($now);
        $reminded = 0;

        PlanAssignment::query()
            ->open()
            ->where('kind', PlanAssignmentKind::Trial->value)
            ->whereNotNull('trial_ends_at')
            ->where('trial_ends_at', '>', $now)
            ->where('trial_ends_at', '<=', $now->addDays(7))
            ->whereHas('billingAccount', fn ($query) => $query->whereNull('deleted_at'))
            ->with(['billingAccount', 'plan'])
            ->each(function (PlanAssignment $trial) use ($notices, $now, &$reminded): void {
                /** @var CarbonImmutable $endsAt */
                $endsAt = $trial->trial_ends_at;
                $step = $endsAt->lessThanOrEqualTo($now->addDay()) ? '1d' : '7d';
                $key = sprintf('trial:%s:%s:%s', $trial->uuid, $endsAt->utc()->toDateString(), $step);

                if ($notices->send($trial->billingAccount, 'trial_reminder', $key, TrialMail::reminder($trial->billingAccount, $trial))) {
                    $reminded++;
                }
            });

        $this->info("Ended {$ended} trials and sent {$reminded} trial reminders.");

        return self::SUCCESS;
    }
}
