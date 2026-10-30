<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account as its owner sees it in the portal: its organizations, whether the
 * owner is a member of each, and the limit (spec 023 US3).
 *
 * @extends JsonResource<BillingAccount>
 */
final class OwnedBillingAccountResource extends JsonResource
{
    /**
     * @param  list<int>  $memberOf  ids of the organizations the owner belongs to
     */
    public function __construct(BillingAccount $resource, private readonly array $memberOf)
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
            'organization_limit' => (int) $this->resource->organization_limit,
            'organizations_count' => (int) $this->resource->organizations->count(),
            'organizations' => $this->organizationSummaries(),
        ];
    }

    /**
     * @return list<array{uuid: string, name: string, created_at: string|null, member: bool}>
     */
    private function organizationSummaries(): array
    {
        return $this->resource->organizations
            ->map(fn (Organization $organization): array => [
                'uuid' => (string) $organization->uuid,
                'name' => (string) $organization->name,
                'created_at' => $organization->created_at?->toIso8601String(),
                'member' => in_array($organization->getKey(), $this->memberOf, true),
            ])
            ->values()
            ->all();
    }
}
