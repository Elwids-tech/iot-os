<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account in the platform administrators' list (spec 023), with its plan
 * (spec 028). `organization_limit` is the `organizations` allowance, null when
 * unlimited; the list eager-loads what `Allowances` needs.
 *
 * @extends JsonResource<BillingAccount>
 */
final class BillingAccountResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'contact_email' => $this->resource->contact_email === null ? null : (string) $this->resource->contact_email,
            'organization_limit' => self::limit(app(Allowances::class)->value($this->resource, AllowanceKind::Organizations)),
            'plan' => $this->resource->openPlanAssignment === null ? null : [
                'uuid' => (string) $this->resource->openPlanAssignment->plan->uuid,
                'name' => (string) $this->resource->openPlanAssignment->plan->name,
            ],
            'organizations_count' => (int) $this->resource->organizations_count,
            'owners' => BillingAccountOwnerResource::collection($this->resource->owners),
            'created_at' => $this->resource->created_at?->toIso8601String(),
            /** Since when an invoice has been unpaid past its due date; nothing is restricted (spec 029 FR-043). */
            'past_due_since' => $this->resource->past_due_since?->toIso8601String(),
        ];
    }

    private static function limit(?int $limit): ?int
    {
        return $limit === null ? null : (int) $limit;
    }
}
