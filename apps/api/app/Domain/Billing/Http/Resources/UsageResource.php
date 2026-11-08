<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Services\MonthlyUsage;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account's usage of one allowance in one UTC month (spec 028 US4). `allowance`
 * is the account's allowance now, null when unlimited, and `left` follows from it (0 once
 * used up). `overage` was fixed as each unit was counted, so changing the allowance never
 * changes it. `organizations` is each organization's share, deleted and moved-away
 * organizations included under the name they had.
 *
 * `devices` is a level (spec 029 US2): `count` is the devices holding a place now (an
 * earlier month shows its peak), `overage` is always 0, and only devices carry
 * `peak_this_month` and `over_limit`.
 *
 * @extends JsonResource<MonthlyUsage>
 */
final class UsageResource extends JsonResource
{
    public function __construct(MonthlyUsage $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var MonthlyUsage $usage */
        $usage = $this->resource;
        $left = $usage->left();

        return [
            /** @var 'alerts'|'sms'|'devices' */
            'kind' => $usage->kind->value,
            /** The first day of the UTC month. */
            'month' => $usage->month->toDateString(),
            'count' => (int) $usage->count,
            'allowance' => $usage->allowance === null ? null : (int) $usage->allowance,
            'left' => $left === null ? null : (int) $left,
            'overage' => (int) $usage->overage,
            /** @var list<array{organization_uuid: string, name: string, count: int}> */
            'organizations' => $usage->organizations ?? [],
            /** Devices only: the month's highest number of devices holding a place. */
            'peak_this_month' => $this->when($usage->kind === AllowanceKind::Devices, fn (): int => (int) $usage->peak),
            /** Devices only: more devices hold a place than the limit allows, after it was lowered or an organization moved in. */
            'over_limit' => $this->when($usage->kind === AllowanceKind::Devices, fn (): bool => $usage->overLimit()),
        ];
    }
}
