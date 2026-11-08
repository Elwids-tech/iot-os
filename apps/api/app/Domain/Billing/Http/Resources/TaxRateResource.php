<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Models\TaxRate;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A named tax rate (spec 029 FR-029); `basis_points` is hundredths of a percent.
 *
 * @extends JsonResource<TaxRate>
 */
final class TaxRateResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'basis_points' => (int) $this->resource->basis_points,
            'archived' => $this->resource->archived_at !== null,
            'archived_at' => $this->resource->archived_at?->toIso8601String(),
        ];
    }
}
