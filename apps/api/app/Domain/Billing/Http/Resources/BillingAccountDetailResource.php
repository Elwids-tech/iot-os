<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccountHistoryEntry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account's page: details, organizations, owners and the latest 100 history
 * entries, newest first (spec 023 US2).
 *
 * @extends JsonResource<BillingAccount>
 */
final class BillingAccountDetailResource extends JsonResource
{
    /**
     * @param  list<BillingAccountHistoryEntry>  $history
     */
    public function __construct(BillingAccount $resource, private readonly array $history)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'contact_email' => $this->resource->contact_email === null ? null : (string) $this->resource->contact_email,
            'notes' => $this->resource->notes === null ? null : (string) $this->resource->notes,
            'organization_limit' => (int) $this->resource->organization_limit,
            'organizations_count' => (int) $this->resource->organizations->count(),
            'created_at' => $this->resource->created_at?->toIso8601String(),
            'owners' => BillingAccountOwnerResource::collection($this->resource->owners),
            'organizations' => BillingAccountOrganizationResource::collection($this->resource->organizations),
            'history' => BillingAccountHistoryResource::collection($this->history),
        ];
    }
}
