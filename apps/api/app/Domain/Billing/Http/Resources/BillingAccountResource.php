<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\BillingAccount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account in the platform administrators' list (spec 023).
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
            'organization_limit' => (int) $this->resource->organization_limit,
            'organizations_count' => (int) $this->resource->organizations_count,
            'owners' => BillingAccountOwnerResource::collection($this->resource->owners),
            'created_at' => $this->resource->created_at?->toIso8601String(),
        ];
    }
}
