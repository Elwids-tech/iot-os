<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Resources;

use App\Domain\Entities\Models\ParameterPlacement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One parameter placed on its own (spec 009, FR-010).
 *
 * @mixin ParameterPlacement
 */
final class ParameterPlacementResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->uuid,
            'parameter_uuid' => (string) $this->parameter_uuid,
            'parameter_key' => (string) $this->parameter_key,
            'leaf_name' => (string) $this->leaf_name,
            'path' => $this->entity->path.'/'.$this->leaf_name,
            'entity' => $this->entitySummary(),
            'started_at' => $this->started_at?->toIso8601String(),
            'ended_at' => $this->ended_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{uuid: string, name: string, path: string}
     */
    private function entitySummary(): array
    {
        return ['uuid' => (string) $this->entity->uuid, 'name' => (string) $this->entity->name, 'path' => (string) $this->entity->path];
    }
}
