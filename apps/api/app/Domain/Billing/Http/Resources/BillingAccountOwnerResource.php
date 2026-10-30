<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account owner, by integer user id (ADR-013).
 *
 * @extends JsonResource<User>
 */
final class BillingAccountOwnerResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $addedAt = $this->resource->pivot?->created_at;

        return [
            'id' => (int) $this->resource->id,
            'name' => (string) $this->resource->name,
            'email' => (string) $this->resource->email,
            'added_at' => $addedAt === null ? null : CarbonImmutable::parse($addedAt)->toIso8601String(),
        ];
    }
}
