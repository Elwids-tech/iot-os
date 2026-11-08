<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\PlanAllowance;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One allowance a plan sets. `value` is null for unlimited.
 *
 * @extends JsonResource<PlanAllowance>
 */
final class PlanAllowanceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var 'alerts'|'sms'|'devices'|'data_points'|'retention_days'|'organizations' */
            'kind' => $this->resource->kind->value,
            'value' => $this->resource->value === null ? null : (int) $this->resource->value,
        ];
    }
}
