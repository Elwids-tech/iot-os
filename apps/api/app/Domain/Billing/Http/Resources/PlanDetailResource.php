<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Services\BillingAccountHistoryEntry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A plan's page: its allowances, the billing accounts on it now (up to 100, longest
 * first) and its latest history (spec 028 US1).
 *
 * @extends JsonResource<BillingPlan>
 */
final class PlanDetailResource extends JsonResource
{
    /**
     * @param  iterable<PlanAssignment>  $assignments  open assignments, with `billingAccount`
     * @param  list<BillingAccountHistoryEntry>  $history
     */
    public function __construct(BillingPlan $resource, private readonly iterable $assignments, private readonly array $history)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...(new PlanResource($this->resource))->toArray($request),
            'accounts' => collect($this->assignments)
                ->map(fn (PlanAssignment $assignment): array => [
                    'uuid' => (string) $assignment->billingAccount->uuid,
                    'name' => (string) $assignment->billingAccount->name,
                    /** @var 'paid'|'trial'|'trial_unpaid' */
                    'kind' => $assignment->kind->value,
                    'since' => $assignment->started_at->toIso8601String(),
                ])
                ->values()
                ->all(),
            'history' => BillingAccountHistoryResource::collection($this->history),
        ];
    }
}
