<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Services\BillingAccountHistoryEntry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One entry of a billing account's history. `action` is created, updated, owner_added,
 * owner_removed, organization_joined or organization_left; `actor` is null for the
 * rollout and for changes made outside a request. By action, an entry also carries
 * the organization, the owner or the changed fields.
 *
 * @extends JsonResource<BillingAccountHistoryEntry>
 */
final class BillingAccountHistoryResource extends JsonResource
{
    public function __construct(BillingAccountHistoryEntry $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var BillingAccountHistoryEntry $entry */
        $entry = $this->resource;

        return [
            'at' => $entry->at->toIso8601String(),
            'action' => $entry->action,
            'actor' => $entry->actor === null ? null : [
                'id' => (int) $entry->actor['id'],
                'name' => (string) $entry->actor['name'],
            ],
            'organization' => $this->when($entry->organization !== null, fn (): array => [
                'uuid' => (string) $entry->organization['uuid'],
                'name' => (string) $entry->organization['name'],
            ]),
            'user' => $this->when($entry->user !== null, fn (): array => [
                'id' => (int) $entry->user['id'],
                'name' => (string) $entry->user['name'],
            ]),
            'changes' => $this->when($entry->changes !== [], fn () => BillingAccountChangeResource::collection($entry->changes)),
        ];
    }
}
