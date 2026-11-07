<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAllowance;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A plan in the platform administrators' list (spec 028 US1). `allowances` lists only
 * the kinds the plan sets; a kind left out falls back to the deployment's default.
 *
 * @extends JsonResource<BillingPlan>
 */
final class PlanResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'description' => $this->resource->description === null ? null : (string) $this->resource->description,
            'archived' => $this->resource->archived_at !== null,
            'archived_at' => $this->resource->archived_at?->toIso8601String(),
            'allowances' => PlanAllowanceResource::collection($this->resource->allowances
                ->sortBy(fn (PlanAllowance $allowance): int|false => array_search($allowance->kind->value, AllowanceKind::values(), true))
                ->values()),
            'accounts_count' => (int) $this->resource->accounts_count,
            'ever_assigned' => (bool) $this->resource->ever_assigned,
            'created_at' => $this->resource->created_at?->toIso8601String(),
        ];
    }
}
