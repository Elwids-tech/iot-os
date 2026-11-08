<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Resources;

use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An organization in the retention page's picker: enough to choose it and nothing more,
 * because `manage-retention` does not grant the organization directory.
 *
 * @extends JsonResource<Organization>
 */
final class RetentionOrganizationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
        ];
    }
}
