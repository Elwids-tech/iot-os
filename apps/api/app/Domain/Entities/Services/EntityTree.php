<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityChange;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The organization's tree (spec 009, FR-001 to FR-004, research R2 and R3).
 *
 * `parent_id` is the truth. `depth`, `path` and `entity_closure` are rewritten here,
 * in the same transaction, and nowhere else. Every change that alters the tree's shape
 * holds the organization's advisory lock, so a cycle or the depth limit cannot slip
 * between two concurrent moves. Each structural change writes an `entity_changes` row
 * and one activity entry; a request that changes nothing writes neither.
 */
final class EntityTree
{
    /** Fields of an entity people edit, for the activity log. */
    private const DESCRIBED = ['name', 'path_name', 'description', 'timezone', 'address', 'latitude', 'longitude'];

    public function __construct(private readonly EntityTypes $types) {}

    /** Serializes structural changes per organization (research R3). */
    public static function lock(Organization $organization): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::select("SELECT pg_advisory_xact_lock(hashtext('entity_tree'), ?)", [$organization->id]);
        }
    }

    /**
     * @param  array<string, mixed>  $values  type_key, parent_uuid, name, path_name, description, timezone, address, latitude, longitude, attributes
     */
    public function create(Organization $organization, array $values, User $actor): Entity
    {
        return DB::transaction(function () use ($organization, $values, $actor): Entity {
            self::lock($organization);
            $this->types->ensureSite($organization);
            $type = $this->type($organization, (string) ($values['type_key'] ?? ''));
            $parent = isset($values['parent_uuid']) ? $this->activeEntity($organization, (string) $values['parent_uuid'], 'parent_uuid') : null;
            $count = Entity::query()->where('organization_id', $organization->id)->count();
            $ceiling = (int) config('entities.max_per_organization');
            if ($count >= $ceiling) {
                throw ValidationException::withMessages(['name' => 'This organization has reached its limit of '.number_format($ceiling).' entities.']);
            }
            $this->checkPlacement($type, $parent, 'type_key');
            $depth = $parent ? $parent->depth + 1 : 0;
            $this->checkDepth($depth, 'parent_uuid');
            $name = $this->name($values['name'] ?? '');
            $pathName = $this->pathName($values['path_name'] ?? null, $name, $type);
            $this->checkSibling($organization, $parent?->id, $pathName, null);
            $details = $this->details($type, $values, null);

            $entity = Entity::create([
                ...$details, 'organization_id' => $organization->id, 'entity_type_id' => $type->id, 'parent_id' => $parent?->id,
                'name' => $name, 'path_name' => $pathName, 'depth' => $depth, 'path' => $this->joined($parent, $pathName),
                'created_by' => $actor->id, 'updated_by' => $actor->id,
            ]);
            DB::statement('INSERT INTO entity_closure (ancestor_id, descendant_id, depth) SELECT ancestor_id, ?, depth + 1 FROM entity_closure WHERE descendant_id = ?', [$entity->id, $parent?->id ?? 0]);
            DB::table('entity_closure')->insert(['ancestor_id' => $entity->id, 'descendant_id' => $entity->id, 'depth' => 0]);
            $this->change($entity, EntityChange::CREATED, $actor, ['new_parent_id' => $parent?->id, 'new_path_name' => $pathName, 'new_type_id' => $type->id]);
            ActivityLog::record('entity.created', $organization, $actor, $entity, ['path' => $entity->path, 'type' => $type->key]);

            return $entity;
        });
    }

    /**
     * Name, path name (a rename), type (a retype), description, time zone, location and attributes.
     *
     * @param  array<string, mixed>  $values
     */
    public function update(Entity $entity, array $values, User $actor): Entity
    {
        return DB::transaction(function () use ($entity, $values, $actor): Entity {
            $organization = $entity->organization;
            self::lock($organization);
            $entity = $this->fresh($entity);
            if ($entity->isArchived()) {
                throw ValidationException::withMessages(['name' => 'Restore this entity before changing it.']);
            }
            $before = [...$entity->only(self::DESCRIBED), 'type' => $entity->type->key, 'attributes' => $entity->custom_attributes ?? []];
            $type = array_key_exists('type_key', $values) ? $this->type($organization, (string) $values['type_key']) : $entity->type;
            $retyped = $type->id !== $entity->entity_type_id;
            if ($retyped) {
                $this->checkRetype($entity, $type);
            }
            $name = array_key_exists('name', $values) ? $this->name($values['name']) : $entity->name;
            $pathName = array_key_exists('path_name', $values) ? $this->pathName($values['path_name'], $name, $type) : $entity->path_name;
            $renamed = $pathName !== $entity->path_name;
            if ($renamed) {
                $this->checkSibling($organization, $entity->parent_id, $pathName, $entity->id);
            } elseif ($retyped) {
                $this->checkNaming($type, $pathName);
            }
            $details = $this->details($type, $values, $entity);
            $oldTypeId = $entity->entity_type_id;
            $oldPathName = $entity->path_name;
            $entity->fill([...$details, 'name' => $name, 'entity_type_id' => $type->id]);
            if (! $entity->isDirty() && ! $renamed) {
                return $entity;
            }
            $entity->forceFill(['updated_by' => $actor->id])->save();
            if ($renamed) {
                $this->rewriteBranch($entity, $this->joined($entity->parent, $pathName), $pathName, 0);
                $this->change($entity, EntityChange::RENAMED, $actor, ['old_path_name' => $oldPathName, 'new_path_name' => $pathName]);
            }
            if ($retyped) {
                $this->change($entity, EntityChange::RETYPED, $actor, ['old_type_id' => $oldTypeId, 'new_type_id' => $type->id]);
            }
            $entity = $this->fresh($entity);
            $after = [...$entity->only(self::DESCRIBED), 'type' => $type->key, 'attributes' => $entity->custom_attributes ?? []];
            ActivityLog::record($retyped ? 'entity.retyped' : 'entity.updated', $organization, $actor, $entity, ['path' => $entity->path], ActivityChanges::between($before, $after));

            return $entity;
        });
    }

    /**
     * What a move would change, for the confirmation people see first (US1 AS4). Device,
     * site and application counts join in PR 2, when devices can be placed.
     *
     * @return array{entities: int}
     */
    public function impact(Entity $entity, ?Entity $parent): array
    {
        return ['entities' => (int) DB::table('entity_closure')->where('ancestor_id', $entity->id)->count()];
    }

    /** Moves the entity and its branch under another parent, or to the top level. */
    public function move(Entity $entity, ?Entity $parent, User $actor): Entity
    {
        return DB::transaction(function () use ($entity, $parent, $actor): Entity {
            $organization = $entity->organization;
            self::lock($organization);
            $entity = $this->fresh($entity);
            $parent = $parent ? $this->fresh($parent) : null;
            if ($entity->isArchived()) {
                throw ValidationException::withMessages(['parent_uuid' => 'Restore this entity before moving it.']);
            }
            if ($parent?->isArchived()) {
                throw ValidationException::withMessages(['parent_uuid' => 'The new parent is archived.']);
            }
            if ($parent?->id === $entity->parent_id) {
                return $entity;
            }
            if ($parent && DB::table('entity_closure')->where('ancestor_id', $entity->id)->where('descendant_id', $parent->id)->exists()) {
                throw ValidationException::withMessages(['parent_uuid' => 'An entity cannot move under itself or one of its descendants.']);
            }
            $this->checkPlacement($entity->type, $parent, 'parent_uuid');
            $depth = $parent ? $parent->depth + 1 : 0;
            $below = (int) DB::table('entity_closure')->where('ancestor_id', $entity->id)->max('depth');
            $this->checkDepth($depth + $below, 'parent_uuid');
            $this->checkSibling($organization, $parent?->id, $entity->path_name, $entity->id);

            $oldParentId = $entity->parent_id;
            $oldPath = $entity->path;
            // Detach the branch from its old ancestors, then attach it under the new parent's.
            DB::statement('DELETE FROM entity_closure WHERE descendant_id IN (SELECT descendant_id FROM entity_closure WHERE ancestor_id = ?) AND ancestor_id NOT IN (SELECT descendant_id FROM entity_closure WHERE ancestor_id = ?)', [$entity->id, $entity->id]);
            if ($parent) {
                DB::statement('INSERT INTO entity_closure (ancestor_id, descendant_id, depth) SELECT above.ancestor_id, below.descendant_id, above.depth + below.depth + 1 FROM entity_closure above CROSS JOIN entity_closure below WHERE above.descendant_id = ? AND below.ancestor_id = ?', [$parent->id, $entity->id]);
            }
            $entity->forceFill(['parent_id' => $parent?->id, 'updated_by' => $actor->id])->save();
            $this->rewriteBranch($entity, $this->joined($parent, $entity->path_name), $entity->path_name, $depth - $entity->depth);
            $this->change($entity, EntityChange::MOVED, $actor, ['old_parent_id' => $oldParentId, 'new_parent_id' => $parent?->id]);
            $entity = $this->fresh($entity);
            ActivityLog::record('entity.moved', $organization, $actor, $entity, ['from' => $oldPath, 'to' => $entity->path], ActivityChanges::between(['path' => $oldPath], ['path' => $entity->path]));

            return $entity;
        });
    }

    /** An entity with no active children leaves the tree and frees its path name; its history stays. */
    public function archive(Entity $entity, User $actor): Entity
    {
        return DB::transaction(function () use ($entity, $actor): Entity {
            $organization = $entity->organization;
            self::lock($organization);
            $entity = $this->fresh($entity);
            if ($entity->isArchived()) {
                return $entity;
            }
            if ($entity->children()->whereNull('archived_at')->exists()) {
                throw ValidationException::withMessages(['entity' => 'Move or archive the entities under this one first.']);
            }
            $entity->forceFill(['archived_at' => now(), 'archived_by' => $actor->id, 'updated_by' => $actor->id])->save();
            $this->change($entity, EntityChange::ARCHIVED, $actor, []);
            ActivityLog::record('entity.archived', $organization, $actor, $entity, ['path' => $entity->path]);

            return $entity;
        });
    }

    /** Back into the tree under its parent, with a new path name when its old one has been taken. */
    public function restore(Entity $entity, ?string $pathName, User $actor): Entity
    {
        return DB::transaction(function () use ($entity, $pathName, $actor): Entity {
            $organization = $entity->organization;
            self::lock($organization);
            $entity = $this->fresh($entity);
            if (! $entity->isArchived()) {
                return $entity;
            }
            if ($entity->parent?->isArchived()) {
                throw ValidationException::withMessages(['path_name' => 'Restore '.$entity->parent->name.' first.']);
            }
            $newPathName = $pathName !== null && $pathName !== '' ? $this->pathName($pathName, $entity->name, $entity->type) : $entity->path_name;
            $this->checkSibling($organization, $entity->parent_id, $newPathName, $entity->id, 'path_name');
            $oldPathName = $entity->path_name;
            // Rename while still archived (the unique index ignores archived entities), then return.
            if ($newPathName !== $oldPathName) {
                $this->rewriteBranch($entity, $this->joined($entity->parent, $newPathName), $newPathName, 0);
            }
            $entity->forceFill(['archived_at' => null, 'archived_by' => null, 'updated_by' => $actor->id])->save();
            $this->change($entity, EntityChange::RESTORED, $actor, []);
            if ($newPathName !== $oldPathName) {
                $this->change($entity, EntityChange::RENAMED, $actor, ['old_path_name' => $oldPathName, 'new_path_name' => $newPathName]);
            }
            $entity = $this->fresh($entity);
            ActivityLog::record('entity.restored', $organization, $actor, $entity, ['path' => $entity->path]);

            return $entity;
        });
    }

    /** Only an entity that never held anything is deleted outright; any other is archived instead. */
    public function delete(Entity $entity, User $actor): void
    {
        DB::transaction(function () use ($entity, $actor): void {
            $organization = $entity->organization;
            self::lock($organization);
            $entity = $this->fresh($entity);
            $heldChildren = Entity::query()->where('parent_id', $entity->id)->exists()
                || EntityChange::query()->where('new_parent_id', $entity->id)->orWhere('old_parent_id', $entity->id)->exists();
            if ($heldChildren) {
                throw ValidationException::withMessages(['entity' => 'This entity has held other entities, so its history matters: archive it instead.']);
            }
            ActivityLog::record('entity.deleted', $organization, $actor, $entity, ['path' => $entity->path]);
            $entity->delete();
        });
    }

    /**
     * Ancestors from the top down, for breadcrumbs.
     *
     * @return list<Entity>
     */
    public function ancestors(Entity $entity): array
    {
        return Entity::query()->join('entity_closure', 'entity_closure.ancestor_id', '=', 'entities.id')
            ->where('entity_closure.descendant_id', $entity->id)->where('entity_closure.depth', '>', 0)
            ->orderByDesc('entity_closure.depth')->get(['entities.*'])->all();
    }

    /** The nearest time zone at or above the entity, else the organization's, else UTC. */
    public function effectiveTimezone(Entity $entity): string
    {
        $zone = Entity::query()->join('entity_closure', 'entity_closure.ancestor_id', '=', 'entities.id')
            ->where('entity_closure.descendant_id', $entity->id)->whereNotNull('entities.timezone')
            ->orderBy('entity_closure.depth')->value('entities.timezone');

        return $zone ?? $entity->organization?->timezone ?? 'UTC';
    }

    private function rewriteBranch(Entity $entity, string $newPath, string $pathName, int $depthDelta): void
    {
        $oldPathLength = strlen($entity->getOriginal('path') ?? $entity->path);
        DB::update(
            'UPDATE entities SET path = ? || substr(path, ?), depth = depth + ? WHERE id IN (SELECT descendant_id FROM entity_closure WHERE ancestor_id = ?)',
            [$newPath, $oldPathLength + 1, $depthDelta, $entity->id],
        );
        Entity::query()->whereKey($entity->id)->update(['path_name' => $pathName]);
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private function change(Entity $entity, string $kind, User $actor, array $values): void
    {
        EntityChange::create([...$values, 'organization_id' => $entity->organization_id, 'entity_id' => $entity->id, 'kind' => $kind, 'user_id' => $actor->id, 'changed_at' => now()]);
    }

    private function type(Organization $organization, string $key): EntityType
    {
        return EntityType::query()->where('organization_id', $organization->id)->where('key', $key)->first()
            ?? throw ValidationException::withMessages(['type_key' => 'Choose one of this organization\'s entity types.']);
    }

    private function activeEntity(Organization $organization, string $uuid, string $field): Entity
    {
        $entity = Entity::query()->where('organization_id', $organization->id)->where('uuid', $uuid)->first();
        if (! $entity || $entity->isArchived()) {
            throw ValidationException::withMessages([$field => 'Choose an active entity of this organization.']);
        }

        return $entity;
    }

    private function fresh(Entity $entity): Entity
    {
        return Entity::query()->with(['type', 'parent.type', 'organization'])->whereKey($entity->id)->firstOrFail();
    }

    private function checkPlacement(EntityType $type, ?Entity $parent, string $field): void
    {
        if ($type->allowsParent($parent?->type)) {
            return;
        }
        $allowed = EntityType::query()->where('organization_id', $type->organization_id)->whereIn('key', $type->parent_type_keys)->orderBy('name')->pluck('name')->all();
        if ($type->top_level) {
            array_unshift($allowed, 'the top level');
        }
        $where = $parent ? 'under '.$parent->type->name : 'at the top level';
        $options = $allowed === [] ? 'It has no allowed place yet; change its rules first.' : 'Allowed: '.implode(', ', $allowed).'.';
        throw ValidationException::withMessages([$field => "{$type->name} cannot sit {$where}. {$options}"]);
    }

    private function checkRetype(Entity $entity, EntityType $type): void
    {
        $this->checkPlacement($type, $entity->parent, 'type_key');
        $children = Entity::query()->with('type')->where('parent_id', $entity->id)->whereNull('archived_at')->get();
        foreach ($children as $child) {
            if (! $child->type->allowsParent($type)) {
                throw ValidationException::withMessages(['type_key' => "{$child->name} ({$child->type->name}) cannot sit under {$type->name}."]);
            }
        }
        if (! $type->carries_timezone && $entity->timezone !== null) {
            throw ValidationException::withMessages(['type_key' => "{$type->name} has no time zone; clear this entity's time zone first."]);
        }
        if (! $type->carries_location && ($entity->address !== null || $entity->latitude !== null)) {
            throw ValidationException::withMessages(['type_key' => "{$type->name} has no location; clear this entity's location first."]);
        }
    }

    private function checkDepth(int $depth, string $field): void
    {
        $max = (int) config('entities.max_depth');
        if ($depth >= $max) {
            throw ValidationException::withMessages([$field => "A branch can be at most {$max} levels deep."]);
        }
    }

    private function checkSibling(Organization $organization, ?int $parentId, string $pathName, ?int $ignore, string $field = 'path_name'): void
    {
        $taken = Entity::query()->where('organization_id', $organization->id)->whereNull('archived_at')
            ->when($parentId, fn ($query) => $query->where('parent_id', $parentId), fn ($query) => $query->whereNull('parent_id'))
            ->whereRaw('lower(path_name) = ?', [strtolower($pathName)])
            ->when($ignore, fn ($query) => $query->whereKeyNot($ignore))
            ->value('name');
        if ($taken !== null) {
            throw ValidationException::withMessages([$field => "{$taken} already uses the path name {$pathName} here."]);
        }
    }

    private function checkNaming(EntityType $type, string $pathName): void
    {
        if ($type->naming_template !== null && ! NamingTemplates::matches($type->naming_template, $pathName)) {
            $hint = trim(($type->naming_description ? $type->naming_description.'. ' : '').'For example '.$type->naming_example.'.');
            throw ValidationException::withMessages(['path_name' => "{$type->name} path names follow {$type->naming_template}. {$hint}"]);
        }
    }

    private function name(mixed $name): string
    {
        $name = trim((string) $name);
        if ($name === '' || mb_strlen($name) > 120) {
            throw ValidationException::withMessages(['name' => 'Names are 1 to 120 characters.']);
        }

        return $name;
    }

    private function pathName(mixed $pathName, string $name, EntityType $type): string
    {
        $pathName = trim((string) ($pathName ?? ''));
        if ($pathName === '') {
            $pathName = PathNames::suggest($name);
            if ($pathName === '') {
                throw ValidationException::withMessages(['path_name' => 'Give a path name: none could be made from the name. '.PathNames::RULE]);
            }
        }
        if (! PathNames::valid($pathName)) {
            throw ValidationException::withMessages(['path_name' => PathNames::RULE]);
        }
        $this->checkNaming($type, $pathName);

        return $pathName;
    }

    /**
     * Description, time zone, location and attributes, each only where the type allows it.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function details(EntityType $type, array $values, ?Entity $entity): array
    {
        $details = [];
        if (array_key_exists('description', $values)) {
            $description = trim((string) ($values['description'] ?? ''));
            $details['description'] = $description === '' ? null : $description;
        }
        if (array_key_exists('timezone', $values)) {
            if ($values['timezone'] !== null && ! $type->carries_timezone) {
                throw ValidationException::withMessages(['timezone' => "{$type->name} entities have no time zone."]);
            }
            $details['timezone'] = $values['timezone'];
        }
        $timezone = array_key_exists('timezone', $details) ? $details['timezone'] : $entity?->timezone;
        if ($type->isSite() && $timezone === null) {
            throw ValidationException::withMessages(['timezone' => 'Sites need a time zone.']);
        }
        foreach (['address', 'latitude', 'longitude'] as $field) {
            if (array_key_exists($field, $values)) {
                if ($values[$field] !== null && ! $type->carries_location) {
                    throw ValidationException::withMessages([$field => "{$type->name} entities have no location."]);
                }
                $details[$field] = $values[$field];
            }
        }
        if (array_key_exists('attributes', $values)) {
            $details['custom_attributes'] = $values['attributes'] ?? [];
        }

        return $details;
    }

    private function joined(?Entity $parent, string $pathName): string
    {
        return $parent ? $parent->path.'/'.$pathName : $pathName;
    }
}
