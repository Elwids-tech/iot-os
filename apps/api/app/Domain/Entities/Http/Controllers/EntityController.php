<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Controllers;

use App\Domain\Entities\Http\Resources\EntityResource;
use App\Domain\Entities\Http\Resources\EntitySummaryResource;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Services\EntityAuthorization;
use App\Domain\Entities\Services\EntityTree;
use App\Domain\Entities\Services\EntityTypes;
use App\Domain\Entities\Services\PathNames;
use App\Domain\Shared\Models\Organization;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

/** The organization's tree (spec 009 US1). */
final class EntityController
{
    public function __construct(private readonly EntityAuthorization $authorization, private readonly EntityTree $tree) {}

    /** One level of the tree: the children of `parent`, or the top level, by name, 100 a page. */
    #[QueryParameter('parent', description: 'The parent entity\'s UUID; omit for the top level.', type: 'string', format: 'uuid')]
    #[QueryParameter('archived', description: '`only` for archived entities, `with` for both; active ones by default.', type: 'string')]
    #[QueryParameter('page', type: 'int')]
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization);
        $filters = $request->validate(['parent' => ['sometimes', 'nullable', 'uuid'], 'archived' => ['sometimes', 'nullable', 'in:only,with'], 'page' => ['sometimes', 'integer', 'min:1']]);
        app(EntityTypes::class)->ensureSite($organization);
        $parent = isset($filters['parent']) ? Entity::query()->where('organization_id', $organization->id)->where('uuid', $filters['parent'])->firstOrFail() : null;
        $page = Entity::query()->where('organization_id', $organization->id)
            ->when($parent, fn ($query) => $query->where('parent_id', $parent->id), fn ($query) => $query->whereNull('parent_id'))
            ->when(($filters['archived'] ?? null) === 'only', fn ($query) => $query->whereNotNull('archived_at'))
            ->when(! isset($filters['archived']), fn ($query) => $query->whereNull('archived_at'))
            ->with(['type', 'parent'])->withCount(['children as active_children_count' => fn ($query) => $query->whereNull('archived_at')])
            ->orderByRaw('lower(name)')->orderBy('id')
            ->paginate((int) config('entities.children_page'));

        return EntitySummaryResource::collection($page);
    }

    /** Entities whose name, path name or path contains the text, shallowest first, 25 a page. */
    #[QueryParameter('q', description: 'At least two characters.', required: true, type: 'string')]
    #[QueryParameter('page', type: 'int')]
    public function search(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization);
        $filters = $request->validate(['q' => ['required', 'string', 'min:2', 'max:200'], 'page' => ['sometimes', 'integer', 'min:1']]);
        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($filters['q'])).'%';
        $page = Entity::query()->where('organization_id', $organization->id)->whereNull('archived_at')
            ->where(fn ($query) => $query->whereRaw("lower(name) like ? escape '\\'", [$needle])->orWhereRaw("lower(path) like ? escape '\\'", [$needle]))
            ->with(['type', 'parent'])->withCount(['children as active_children_count' => fn ($query) => $query->whereNull('archived_at')])
            ->orderBy('depth')->orderBy('path')
            ->paginate((int) config('entities.search_page'));

        return EntitySummaryResource::collection($page);
    }

    public function show(Request $request, Organization $organization, Entity $entity): EntityResource
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization, $entity);

        return new EntityResource($entity->load(['type', 'parent.type', 'organization']));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization);
        $values = $request->validate([
            'type_key' => ['required', 'string', 'max:40'],
            'parent_uuid' => ['sometimes', 'nullable', 'uuid'],
            ...$this->rules(true),
        ]);
        $entity = $this->tree->create($organization, $values, $request->user());

        return (new EntityResource($entity->load(['type', 'parent.type', 'organization'])))->response()->setStatusCode(201);
    }

    /** Name, path name (renames the branch's paths), type, description, time zone, location and attributes. */
    public function update(Request $request, Organization $organization, Entity $entity): EntityResource
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization, $entity);
        $values = $request->validate(['type_key' => ['sometimes', 'string', 'max:40'], ...$this->rules(false)]);

        return new EntityResource($this->tree->update($entity, $values, $request->user()));
    }

    /**
     * What moving the entity under `parent` would change; ask before moving.
     *
     * @return array{data: array{entities: int, devices: int, devices_changing_site: int, devices_changing_timezone: int, applications: list<array{uuid: string, name: string, gains: int, loses: int}>}}
     */
    #[QueryParameter('parent', description: 'The new parent\'s UUID; omit for the top level.', type: 'string', format: 'uuid')]
    public function moveImpact(Request $request, Organization $organization, Entity $entity): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization, $entity);
        $filters = $request->validate(['parent' => ['sometimes', 'nullable', 'uuid']]);

        return ['data' => $this->tree->impact($entity, $this->parent($organization, $filters['parent'] ?? null, 'parent'))];
    }

    /** Moves the entity and its branch under `parent_uuid`, or to the top level when it is null. */
    public function move(Request $request, Organization $organization, Entity $entity): EntityResource
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization, $entity);
        $values = $request->validate(['parent_uuid' => ['present', 'nullable', 'uuid']]);

        return new EntityResource($this->tree->move($entity, $this->parent($organization, $values['parent_uuid'], 'parent_uuid'), $request->user()));
    }

    public function archive(Request $request, Organization $organization, Entity $entity): EntityResource
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization, $entity);

        return new EntityResource($this->tree->archive($entity, $request->user())->load(['type', 'parent.type', 'organization']));
    }

    /** Back into the tree; give `path_name` when the old one has been taken. */
    public function restore(Request $request, Organization $organization, Entity $entity): EntityResource
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization, $entity);
        $values = $request->validate(['path_name' => ['sometimes', 'nullable', 'string', 'max:64']]);

        return new EntityResource($this->tree->restore($entity, $values['path_name'] ?? null, $request->user()));
    }

    /** Only an entity that never held anything can be deleted; archive any other. */
    public function destroy(Request $request, Organization $organization, Entity $entity): Response
    {
        $this->authorization->authorize($request->user(), EntityPermission::MANAGE, $organization, $entity);
        $this->tree->delete($entity, $request->user());

        return response()->noContent();
    }

    /**
     * A path name made from a display name; empty when none can be made.
     *
     * @return array{data: array{path_name: string}}
     */
    #[QueryParameter('name', required: true, type: 'string')]
    public function pathNameSuggestion(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization);
        $values = $request->validate(['name' => ['required', 'string', 'max:120']]);

        return ['data' => ['path_name' => PathNames::suggest($values['name'])]];
    }

    private function parent(Organization $organization, ?string $uuid, string $field): ?Entity
    {
        if ($uuid === null) {
            return null;
        }

        return Entity::query()->where('organization_id', $organization->id)->where('uuid', $uuid)->first()
            ?? throw ValidationException::withMessages([$field => 'Choose an entity of this organization.']);
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(bool $creating): array
    {
        return [
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:120'],
            'path_name' => ['sometimes', 'nullable', 'string', 'max:64'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'timezone' => ['sometimes', 'nullable', 'timezone:all'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
            // Not "sometimes": a coordinate sent alone must fail required_with.
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'attributes' => ['sometimes', 'nullable', 'array:'.self::attributeKeys(), 'max:'.(int) config('entities.max_attributes')],
            'attributes.*' => ['nullable', function (string $attribute, mixed $value, \Closure $fail): void {
                if (! is_string($value) && ! is_int($value) && ! is_float($value) && ! is_bool($value) && $value !== null || is_string($value) && mb_strlen($value) > 500) {
                    $fail('Attribute values are text up to 500 characters, numbers or true/false.');
                }
            }],
        ];
    }

    /** Attribute keys are free-form identifiers, as on devices; the array rule needs them listed. */
    private static function attributeKeys(): string
    {
        $attributes = request()->input('attributes');
        $keys = is_array($attributes) ? array_keys($attributes) : [];
        foreach ($keys as $key) {
            if (! is_string($key) || ! preg_match('/^[a-z][a-z0-9_.-]{0,63}$/', $key)) {
                throw ValidationException::withMessages(['attributes' => 'Attribute names start with a lowercase letter and use lowercase letters, digits, dots, dashes or underscores.']);
            }
        }

        return implode(',', $keys) ?: '_';
    }
}
