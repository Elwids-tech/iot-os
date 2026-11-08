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
 * Devices are a level (spec 029 US2): `count` is the devices holding a place now, or the
 * month's peak for an earlier month; `peak` is the month's highest count; they have no
 * overage, and an account can be over its limit after the limit was lowered.
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
        public ?int $peak = null,
    ) {}

    /** What is left of the allowance this month: null when unlimited, 0 once used up. */
    public function left(): ?int
    {
        return $this->allowance === null ? null : max(0, $this->allowance - $this->count);
    }

    /** More devices hold a place than the limit allows. */
    public function overLimit(): bool
    {
        return $this->allowance !== null && $this->count > $this->allowance;
    }
}
