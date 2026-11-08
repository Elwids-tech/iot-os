<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Services\OrganizationUsage;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One allowance this month as a manager of the organization sees it (spec 028 FR-022,
 * spec 029 FR-024): the organization's own count, and what its billing account allows,
 * has left and is over by. It never names the account or its other organizations.
 *
 * @extends JsonResource<OrganizationUsage>
 */
final class OrganizationUsageResource extends JsonResource
{
    public function __construct(OrganizationUsage $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var OrganizationUsage $usage */
        $usage = $this->resource;
        $left = $usage->account->left();

        return [
            /** @var 'alerts'|'sms'|'data_points' */
            'kind' => $usage->account->kind->value,
            /** The first day of the UTC month. */
            'month' => $usage->account->month->toDateString(),
            /** This organization's count this month. */
            'count' => (int) $usage->count,
            /** The billing account's allowance; null when unlimited. */
            'allowance' => $usage->account->allowance === null ? null : (int) $usage->account->allowance,
            /** What is left on the billing account this month: null when unlimited, 0 once used up. */
            'left' => $left === null ? null : (int) $left,
            /** The billing account's overage this month. */
            'overage' => (int) $usage->account->overage,
            /** Data points only: the runtime has reported the whole month. */
            'final' => $this->when($usage->account->kind === AllowanceKind::DataPoints, fn (): bool => (bool) $usage->account->final),
            /** Data points only: when the runtime last reported; null before its first report. */
            'reported_at' => $this->when($usage->account->kind === AllowanceKind::DataPoints, fn (): ?string => $usage->account->reportedAt?->toIso8601ZuluString()),
            /** Data points only: the month is open and has not been reported for longer than usual. */
            'stale' => $this->when($usage->account->kind === AllowanceKind::DataPoints, fn (): bool => (bool) $usage->account->stale),
        ];
    }
}
