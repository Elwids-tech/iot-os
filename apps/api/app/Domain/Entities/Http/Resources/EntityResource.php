<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Resources;

use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Services\EntityTree;
use App\Domain\Entities\Services\EntityTypes;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One entity with its breadcrumb, effective time zone and the rules it breaks now
 * (spec 009, contracts/api.md).
 *
 * @mixin Entity
 */
final class EntityResource extends JsonResource
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
            /** @var list<array{uuid: string, name: string, path_name: string}> */
            'ancestors' => $this->ancestorList(),
            'description' => $this->description,
            'timezone' => $this->timezone,
            'effective_timezone' => app(EntityTree::class)->effectiveTimezone($this->resource),
            'address' => $this->address,
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            /** @var array<string, string|int|float|bool|null> */
            'attributes' => (object) ($this->custom_attributes ?? []),
            'children_count' => (int) $this->children()->whereNull('archived_at')->count(),
            /** @var list<'parent_type'|'naming'> */
            'outside_rules' => app(EntityTypes::class)->outsideRules($this->resource),
            'archived_at' => $this->archived_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{key: string, name: string}
     */
    private function typeSummary(): array
    {
        return ['key' => (string) $this->type->key, 'name' => (string) $this->type->name];
    }

    /**
     * From the top down.
     *
     * @return list<array{uuid: string, name: string, path_name: string}>
     */
    private function ancestorList(): array
    {
        return array_map(static fn (Entity $ancestor): array => [
            'uuid' => (string) $ancestor->uuid, 'name' => (string) $ancestor->name, 'path_name' => (string) $ancestor->path_name,
        ], app(EntityTree::class)->ancestors($this->resource));
    }
}
