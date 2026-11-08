<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Enums\AllowanceKind;
use Carbon\CarbonImmutable;

/**
 * One allowance's usage in one UTC month (spec 028 US4). `allowance` is the account's
 * allowance now, null when unlimited; `overage` was fixed when each unit was counted, so
 * a later allowance change only moves what is left. `organizations` is each
 * organization's share by name, or null where it must not be shown.
 *
 * Data points come from the runtime's reports (spec 029 US3, FR-014): `final` says the
 * runtime has reported the whole month, `reportedAt` when it last reported, and `stale`
 * that a month still open has not been reported for longer than
 * `billing.usage_report_stale_seconds`. They are null for the other kinds.
 */
final readonly class MonthlyUsage
{
    /**
     * @param  list<array{organization_uuid: string, name: string, count: int}>|null  $organizations
     */
    public function __construct(
        public AllowanceKind $kind,
        public CarbonImmutable $month,
        public int $count,
        public ?int $allowance,
        public int $overage,
        public ?array $organizations = null,
        public ?bool $final = null,
        public ?CarbonImmutable $reportedAt = null,
        public ?bool $stale = null,
    ) {}

    /** What is left of the allowance this month: null when unlimited, 0 once used up. */
    public function left(): ?int
    {
        return $this->allowance === null ? null : max(0, $this->allowance - $this->count);
    }
}
