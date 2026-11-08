<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\PlanAssignment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The plan a billing account is on now, and since when (ADR-035).
 *
 * @extends JsonResource<PlanAssignment>
 */
final class PlanAssignmentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            /** @var 'paid'|'trial'|'trial_unpaid' */
            'kind' => $this->resource->kind->value,
            'plan' => [
                'uuid' => (string) $this->resource->plan->uuid,
                'name' => (string) $this->resource->plan->name,
                'archived' => $this->resource->plan->archived_at !== null,
            ],
            'started_at' => $this->resource->started_at->toIso8601String(),
            'trial_ends_at' => $this->resource->trial_ends_at?->toIso8601String(),
        ];
    }
}
