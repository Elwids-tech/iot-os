<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Resources;

use App\Domain\Entities\Models\EntityPlacement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One period of a device at an entity (spec 009, FR-009, US6 AS1).
 *
 * @mixin EntityPlacement
 */
final class PlacementResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->uuid,
            'entity' => $this->entitySummary(),
            /** Null for a placement from before placement history was kept. */
            'started_at' => $this->started_at?->toIso8601String(),
            'ended_at' => $this->ended_at?->toIso8601String(),
            /** @var 'moved'|'unplaced'|'device_archived'|'moved_out'|'entity_archived'|null */
            'end_reason' => $this->end_reason,
            'started_by' => $this->started_by === null ? null : (int) $this->started_by,
            'ended_by' => $this->ended_by === null ? null : (int) $this->ended_by,
        ];
    }

    /**
     * The entity with its path today.
     *
     * @return array{uuid: string, name: string, path: string, archived: bool}
     */
    private function entitySummary(): array
    {
        return ['uuid' => (string) $this->entity->uuid, 'name' => (string) $this->entity->name, 'path' => (string) $this->entity->path, 'archived' => $this->entity->archived_at !== null];
    }
}
