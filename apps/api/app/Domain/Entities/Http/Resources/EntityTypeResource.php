<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Resources;

use App\Domain\Entities\Models\EntityType;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An entity type with its rules (spec 009, FR-006).
 *
 * @mixin EntityType
 */
final class EntityTypeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->uuid,
            'key' => (string) $this->key,
            'name' => (string) $this->name,
            'top_level' => (bool) $this->top_level,
            /** @var list<string> */
            'parent_type_keys' => array_values($this->parent_type_keys ?? []),
            /** @var list<string> */
            'member_type_keys' => array_values($this->member_type_keys ?? []),
            'accepts_devices' => (bool) $this->accepts_devices,
            'carries_timezone' => (bool) $this->carries_timezone,
            'carries_location' => (bool) $this->carries_location,
            'naming' => $this->naming(),
            /** @var list<string> */
            'preset_keys' => array_values($this->preset_keys ?? []),
            'entities_count' => (int) ($this->entities_count ?? 0),
        ];
    }

    /**
     * @return array{template: string, example: string|null, description: string|null}|null
     */
    private function naming(): ?array
    {
        return $this->naming_template === null ? null : [
            'template' => (string) $this->naming_template,
            'example' => $this->naming_example,
            'description' => $this->naming_description,
        ];
    }
}
