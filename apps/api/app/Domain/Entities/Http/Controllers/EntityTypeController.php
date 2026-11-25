<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Controllers;

use App\Domain\Entities\Http\Resources\EntityTypeResource;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Permissions\EntityTypePermission;
use App\Domain\Entities\Services\EntityAuthorization;
use App\Domain\Entities\Services\EntityTypes;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/** Entity types and their rules (spec 009 US5). */
final class EntityTypeController
{
    public function __construct(private readonly EntityAuthorization $authorization, private readonly EntityTypes $types) {}

    /** Every type of the organization, the Site type included, by name. */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization);
        $this->types->ensureSite($organization);

        return EntityTypeResource::collection(EntityType::query()->where('organization_id', $organization->id)->withCount('entities')->orderBy('name')->get());
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $this->authorization->authorize($request->user(), EntityTypePermission::MANAGE, $organization);
        $values = $request->validate(['key' => ['required', 'string', 'max:40'], ...$this->rules(true)]);
        $type = $this->types->create($organization, $values, $request->user());

        return (new EntityTypeResource($type->loadCount('entities')))->response()->setStatusCode(201);
    }

    public function update(Request $request, Organization $organization, EntityType $type): EntityTypeResource
    {
        $this->authorization->authorize($request->user(), EntityTypePermission::MANAGE, $organization, $type);
        $values = $request->validate($this->rules(false));

        return new EntityTypeResource($this->types->update($type, $values, $request->user())->loadCount('entities'));
    }

    public function destroy(Request $request, Organization $organization, EntityType $type): Response
    {
        $this->authorization->authorize($request->user(), EntityTypePermission::MANAGE, $organization, $type);
        $this->types->delete($type, $request->user());

        return response()->noContent();
    }

    /**
     * @return array<string, list<string>>
     */
    private function rules(bool $creating): array
    {
        $present = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$present, 'string', 'max:80'],
            'top_level' => ['sometimes', 'boolean'],
            'parent_type_keys' => ['sometimes', 'array', 'max:50'],
            'parent_type_keys.*' => ['string', 'max:40'],
            'member_type_keys' => ['sometimes', 'array', 'max:50'],
            'member_type_keys.*' => ['string', 'max:40'],
            'accepts_devices' => ['sometimes', 'boolean'],
            'carries_timezone' => ['sometimes', 'boolean'],
            'carries_location' => ['sometimes', 'boolean'],
            'naming_template' => ['sometimes', 'nullable', 'string', 'max:120'],
            'naming_example' => ['sometimes', 'nullable', 'string', 'max:64'],
            'naming_description' => ['sometimes', 'nullable', 'string', 'max:240'],
        ];
    }
}
