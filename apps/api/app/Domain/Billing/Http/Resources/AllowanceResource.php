<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Services\ResolvedAllowance;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One of a billing account's allowances and where it comes from (ADR-035). `value` is
 * null for unlimited; for `retention_days`, null means the platform setting applies.
 *
 * @extends JsonResource<ResolvedAllowance>
 */
final class AllowanceResource extends JsonResource
{
    public function __construct(ResolvedAllowance $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ResolvedAllowance $allowance */
        $allowance = $this->resource;

        return [
            /** @var 'alerts'|'sms'|'devices'|'data_points'|'retention_days'|'organizations' */
            'kind' => $allowance->kind->value,
            'value' => $allowance->value === null ? null : (int) $allowance->value,
            /** @var 'override'|'plan'|'default' */
            'source' => $allowance->source,
            'note' => $allowance->note === null ? null : (string) $allowance->note,
        ];
    }
}
