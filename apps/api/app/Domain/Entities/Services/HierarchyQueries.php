<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Shared\Models\Organization;

/**
 * What other features read to propose changes (spec 009, research R13): the types and
 * their rules, an entity by path, a level of the tree, where a device is. Entities are
 * returned as plain arrays so callers never write through the models.
 *
 * @phpstan-type EntityView array{uuid: string, name: string, path_name: string, path: string, type_key: string, parent_uuid: ?string}
 */
final class HierarchyQueries
{
    public function __construct(private readonly EntityTypes $types) {}

    /**
     * @return list<array{key: string, name: string, top_level: bool, parent_type_keys: list<string>, member_type_keys: list<string>, accepts_devices: bool, naming: ?array{template: string, example: ?string, description: ?string}}>
     */
    public function types(Organization $organization): array
    {
        $this->types->ensureSite($organization);

        return EntityType::query()->where('organization_id', $organization->id)->orderBy('name')->get()->map(fn (EntityType $type): array => [
            'key' => $type->key, 'name' => $type->name, 'top_level' => $type->top_level,
            'parent_type_keys' => $type->parent_type_keys, 'member_type_keys' => $type->member_type_keys, 'accepts_devices' => $type->accepts_devices,
            'naming' => $type->naming_template === null ? null : ['template' => $type->naming_template, 'example' => $type->naming_example, 'description' => $type->naming_description],
        ])->all();
    }

    /** @return EntityView|null  the active entity at this path, compared ignoring case */
    public function findByPath(Organization $organization, string $path): ?array
    {
        $entity = Entity::query()->with(['type', 'parent'])->where('organization_id', $organization->id)->whereNull('archived_at')
            ->whereRaw('lower(path) = ?', [strtolower(trim($path, '/'))])->first();

        return $entity ? $this->view($entity) : null;
    }

    /** @return list<EntityView>  active children of a parent, or the top level */
    public function children(Organization $organization, ?string $parentUuid): array
    {
        $parent = $parentUuid === null ? null : Entity::query()->where('organization_id', $organization->id)->where('uuid', $parentUuid)->first();
        if ($parentUuid !== null && ! $parent) {
            return [];
        }

        return Entity::query()->with(['type', 'parent'])->where('organization_id', $organization->id)->whereNull('archived_at')
            ->when($parent, fn ($q) => $q->where('parent_id', $parent->id), fn ($q) => $q->whereNull('parent_id'))
            ->orderBy('path')->get()->map(fn (Entity $entity): array => $this->view($entity))->all();
    }

    /** @return EntityView|null  where the device is placed now */
    public function placementOf(Device $device): ?array
    {
        $entity = Entity::query()->with(['type', 'parent'])
            ->whereIn('id', EntityPlacement::query()->select('entity_id')->where('device_id', $device->id)->whereNull('ended_at'))->first();

        return $entity ? $this->view($entity) : null;
    }

    /** @return EntityView */
    private function view(Entity $entity): array
    {
        return ['uuid' => $entity->uuid, 'name' => $entity->name, 'path_name' => $entity->path_name, 'path' => $entity->path, 'type_key' => $entity->type->key, 'parent_uuid' => $entity->parent?->uuid];
    }
}
