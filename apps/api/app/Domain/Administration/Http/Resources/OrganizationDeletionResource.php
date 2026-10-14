<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Whether an organization can be deleted, what blocks it and what deletion removes.
 *
 * @extends JsonResource<Organization>
 */
final class OrganizationDeletionResource extends JsonResource
{
    /**
     * @param  list<array{key: string, label: string, count: int}>  $blockers
     * @param  list<array{key: string, label: string, count: int}>  $removes
     */
    public function __construct(Organization $resource, private readonly array $blockers, private readonly array $removes)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'organization' => [
                'uuid' => (string) $this->resource->uuid,
                'name' => (string) $this->resource->name,
                'slug' => (string) $this->resource->slug,
            ],
            'deletable' => $this->blockers === [],
            'blockers' => OrganizationDeletionEntryResource::collection($this->blockers),
            'removes' => OrganizationDeletionEntryResource::collection($this->removes),
        ];
    }
}
