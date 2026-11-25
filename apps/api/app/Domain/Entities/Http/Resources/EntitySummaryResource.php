<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Resources;

use App\Domain\Entities\Models\Entity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An entity in a list: a level of the tree or a search result.
 *
 * @mixin Entity
 */
final class EntitySummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->uuid,
            'name' => (string) $this->name,
            'path_name' => (string) $this->path_name,
            'path' => (string) $this->path,
            'depth' => (int) $this->depth,
            'type' => $this->typeSummary(),
            'parent_uuid' => $this->parent?->uuid,
            'children_count' => (int) ($this->active_children_count ?? 0),
            'archived_at' => $this->archived_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{key: string, name: string}
     */
    private function typeSummary(): array
    {
        return ['key' => (string) $this->type->key, 'name' => (string) $this->type->name];
    }
}
