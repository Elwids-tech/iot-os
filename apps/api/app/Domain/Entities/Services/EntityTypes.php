<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Entity types and their rules (spec 009, FR-006 to FR-008). A rule change never
 * changes an entity: entities that break a current rule are reported as outside it.
 */
final class EntityTypes
{
    /** Fields a type's rules are made of, as people edit them. */
    public const FIELDS = ['name', 'top_level', 'parent_type_keys', 'member_type_keys', 'accepts_devices', 'carries_timezone', 'carries_location', 'naming_template', 'naming_example', 'naming_description'];

    /** What the Site type always keeps, because the site compatibility view needs it (research R4). */
    private const SITE_FIXED = ['top_level', 'accepts_devices', 'carries_timezone', 'carries_location'];

    /**
     * The organization's Site type, created the first time anything uses the hierarchy,
     * so no organization creation path changes (research R4).
     */
    public function ensureSite(Organization $organization): EntityType
    {
        $existing = EntityType::query()->where('organization_id', $organization->id)->where('key', EntityType::SITE)->first();
        if ($existing) {
            return $existing;
        }
        try {
            return DB::transaction(fn () => EntityType::create([
                'organization_id' => $organization->id, 'key' => EntityType::SITE, 'name' => $this->freeName($organization, 'Site'),
                'top_level' => true, 'parent_type_keys' => [], 'member_type_keys' => [],
                'accepts_devices' => true, 'carries_timezone' => true, 'carries_location' => true, 'preset_keys' => [],
            ]));
        } catch (UniqueConstraintViolationException) {
            return EntityType::query()->where('organization_id', $organization->id)->where('key', EntityType::SITE)->firstOrFail();
        }
    }

    /**
     * @param  array<string, mixed>  $values  `key` plus FIELDS
     */
    public function create(Organization $organization, array $values, User $actor): EntityType
    {
        return DB::transaction(function () use ($organization, $values, $actor): EntityType {
            EntityTree::lock($organization);
            $this->ensureSite($organization);
            $key = (string) $values['key'];
            if (preg_match('/^[a-z][a-z0-9_]{0,39}$/', $key) !== 1) {
                throw ValidationException::withMessages(['key' => 'Keys start with a lowercase letter and use lowercase letters, digits and underscores, up to 40 characters.']);
            }
            if (EntityType::query()->where('organization_id', $organization->id)->where('key', $key)->exists()) {
                throw ValidationException::withMessages(['key' => "The key {$key} is already used by another type."]);
            }
            $attributes = $this->checked($organization, null, $key, $values);
            $type = EntityType::create([...$attributes, 'organization_id' => $organization->id, 'key' => $key, 'preset_keys' => [], 'created_by' => $actor->id, 'updated_by' => $actor->id]);
            ActivityLog::record('entity_type.created', $organization, $actor, $type, ['key' => $key]);

            return $type;
        });
    }

    /**
     * @param  array<string, mixed>  $values  any of FIELDS
     */
    public function update(EntityType $type, array $values, User $actor): EntityType
    {
        return DB::transaction(function () use ($type, $values, $actor): EntityType {
            $organization = $type->organization;
            EntityTree::lock($organization);
            $type = EntityType::query()->whereKey($type->id)->firstOrFail();
            if ($type->isSite()) {
                foreach (self::SITE_FIXED as $field) {
                    if (array_key_exists($field, $values) && (bool) $values[$field] !== true) {
                        throw ValidationException::withMessages([$field => 'The Site type always sits at the top level, accepts devices and carries a time zone and a location, because sites need them.']);
                    }
                }
            }
            $before = $type->only(self::FIELDS);
            $attributes = $this->checked($organization, $type, $type->key, [...$before, ...$values]);
            $type->fill($attributes);
            if (! $type->isDirty()) {
                return $type;
            }
            $type->forceFill(['updated_by' => $actor->id])->save();
            ActivityLog::record('entity_type.updated', $organization, $actor, $type, ['key' => $type->key], ActivityChanges::between($before, $type->only(self::FIELDS)));

            return $type;
        });
    }

    /** A type in use, or named by another type's rules, cannot be deleted (FR-008). */
    public function delete(EntityType $type, User $actor): void
    {
        DB::transaction(function () use ($type, $actor): void {
            $organization = $type->organization;
            EntityTree::lock($organization);
            if ($type->isSite()) {
                throw ValidationException::withMessages(['type' => 'The Site type cannot be deleted; existing sites are its entities.']);
            }
            if (Entity::query()->where('entity_type_id', $type->id)->exists()) {
                throw ValidationException::withMessages(['type' => "{$type->name} is in use. Retype or delete its entities first; renaming it is allowed."]);
            }
            $referencing = EntityType::query()->where('organization_id', $organization->id)->whereKeyNot($type->id)->get()
                ->filter(fn (EntityType $other) => in_array($type->key, [...$other->parent_type_keys, ...$other->member_type_keys], true));
            if ($referencing->isNotEmpty()) {
                throw ValidationException::withMessages(['type' => "{$type->name} is named in the rules of ".$referencing->pluck('name')->join(', ', ' and ').'. Remove it there first.']);
            }
            ActivityLog::record('entity_type.deleted', $organization, $actor, $type, ['key' => $type->key]);
            $type->delete();
        });
    }

    /**
     * The rules an entity breaks as they stand now (FR-008): `parent_type` when its type no
     * longer allows its parent, `naming` when its path name no longer matches the template.
     *
     * @return list<'parent_type'|'naming'>
     */
    public function outsideRules(Entity $entity): array
    {
        $type = $entity->type;
        $broken = [];
        if (! $type->allowsParent($entity->parent?->type)) {
            $broken[] = 'parent_type';
        }
        if ($type->naming_template !== null && ! NamingTemplates::matches($type->naming_template, $entity->path_name)) {
            $broken[] = 'naming';
        }

        return $broken;
    }

    /** A name not yet used by another type, suffixed when taken (used for built-in types). */
    public function freeName(Organization $organization, string $name, ?string $suffix = null): string
    {
        $taken = fn (string $candidate) => EntityType::query()->where('organization_id', $organization->id)->whereRaw('lower(name) = ?', [mb_strtolower($candidate)])->exists();
        if (! $taken($name)) {
            return $name;
        }
        $candidate = $suffix ? "{$name} ({$suffix})" : $name;
        for ($n = 2; $taken($candidate); $n++) {
            $candidate = "{$name} {$n}";
        }

        return $candidate;
    }

    /**
     * Validates the rules of a type and returns the attributes to store.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function checked(Organization $organization, ?EntityType $type, string $key, array $values): array
    {
        $name = trim((string) ($values['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 80) {
            throw ValidationException::withMessages(['name' => 'Names are 1 to 80 characters.']);
        }
        $nameTaken = EntityType::query()->where('organization_id', $organization->id)->whereRaw('lower(name) = ?', [mb_strtolower($name)])
            ->when($type, fn ($query) => $query->whereKeyNot($type->id))->exists();
        if ($nameTaken) {
            throw ValidationException::withMessages(['name' => "Another type is already called {$name}."]);
        }
        $known = EntityType::query()->where('organization_id', $organization->id)->pluck('key')->push($key)->all();
        foreach (['parent_type_keys', 'member_type_keys'] as $field) {
            $keys = array_values(array_unique(array_map('strval', $values[$field] ?? [])));
            $unknown = array_diff($keys, $known);
            if ($unknown !== []) {
                throw ValidationException::withMessages([$field => 'Unknown type '.implode(', ', $unknown).'.']);
            }
            $values[$field] = $keys;
        }
        $template = isset($values['naming_template']) && trim((string) $values['naming_template']) !== '' ? trim((string) $values['naming_template']) : null;
        $example = isset($values['naming_example']) && trim((string) $values['naming_example']) !== '' ? trim((string) $values['naming_example']) : null;
        $description = isset($values['naming_description']) && trim((string) $values['naming_description']) !== '' ? trim((string) $values['naming_description']) : null;
        if ($template !== null) {
            if (NamingTemplates::compile($template) === null) {
                throw ValidationException::withMessages(['naming_template' => NamingTemplates::HELP]);
            }
            if ($example === null || ! NamingTemplates::matches($template, $example)) {
                throw ValidationException::withMessages(['naming_example' => "Give an example that follows {$template}."]);
            }
            if ($description !== null && mb_strlen($description) > 240) {
                throw ValidationException::withMessages(['naming_description' => 'Descriptions are up to 240 characters.']);
            }
        } else {
            $example = $description = null;
        }

        return [
            'name' => $name,
            'top_level' => (bool) ($values['top_level'] ?? false),
            'parent_type_keys' => $values['parent_type_keys'],
            'member_type_keys' => $values['member_type_keys'],
            'accepts_devices' => (bool) ($values['accepts_devices'] ?? false),
            'carries_timezone' => (bool) ($values['carries_timezone'] ?? false),
            'carries_location' => (bool) ($values['carries_location'] ?? false),
            'naming_template' => $template,
            'naming_example' => $example,
            'naming_description' => $description,
        ];
    }
}
