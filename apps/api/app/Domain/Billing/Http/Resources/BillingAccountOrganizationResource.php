<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An organization on a billing account's page, with when it joined the account.
 *
 * @extends JsonResource<Organization>
 */
final class BillingAccountOrganizationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $assignedAt = $this->resource->getAttribute('assigned_at');

        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'slug' => (string) $this->resource->slug,
            'users_count' => (int) $this->resource->getAttribute('users_count'),
            'devices_count' => (int) $this->resource->getAttribute('devices_count'),
            'assigned_at' => $assignedAt === null ? null : CarbonImmutable::parse($assignedAt)->toIso8601String(),
        ];
    }
}
