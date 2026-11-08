<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

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
            /** @var 'alerts'|'sms' */
            'kind' => $usage->kind->value,
            /** The first day of the UTC month. */
            'month' => $usage->month->toDateString(),
            'count' => (int) $usage->count,
            'allowance' => $usage->allowance === null ? null : (int) $usage->allowance,
            'left' => $left === null ? null : (int) $left,
            'overage' => (int) $usage->overage,
            /** @var list<array{organization_uuid: string, name: string, count: int}> */
            'organizations' => $usage->organizations ?? [],
        ];
    }
}
