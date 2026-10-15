<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A selectable model with its price in USD per million tokens.
 */
final class AssistantModelResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->resource['id'],
            'label' => (string) $this->resource['label'],
            'input_usd_per_million' => (float) $this->resource['input_usd_per_million'],
            'output_usd_per_million' => (float) $this->resource['output_usd_per_million'],
        ];
    }
}
