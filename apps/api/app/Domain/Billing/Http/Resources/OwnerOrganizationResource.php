<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The organization an owner just created. The portal reloads the session for its
 * capabilities, so this carries only what it needs to open it.
 *
 * @extends JsonResource<Organization>
 */
final class OwnerOrganizationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'slug' => (string) $this->resource->slug,
        ];
    }
}
