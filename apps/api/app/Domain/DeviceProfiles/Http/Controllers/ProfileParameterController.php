<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Http\Requests\ReorderProfileParametersRequest;
use App\Domain\DeviceProfiles\Http\Requests\UpsertProfileParameterRequest;
use App\Domain\DeviceProfiles\Http\Resources\ProfileParameterResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Models\ProfileParameterGroup;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

final class ProfileParameterController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly DeviceProfileAuthoring $authoring,
    ) {}

    public function store(UpsertProfileParameterRequest $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorize($request->user(), $organization, $profile);
        [$attributes, $draftRevision, $groupUuid] = $this->attributes($request->validated());

        $result = $this->authoring->mutate($profile, $request->user(), $draftRevision, function (DeviceProfile $locked) use ($attributes, $groupUuid): ProfileParameter {
            $attributes['parameter_group_id'] = $this->groupId($locked, $groupUuid);

            return $locked->parameters()->create($attributes);
        });

        return ProfileParameterResource::make($result['result']->load('group'))->response()->setStatusCode(201);
    }

    public function update(UpsertProfileParameterRequest $request, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): ProfileParameterResource
    {
        $this->authorize($request->user(), $organization, $profile);
        $this->ensureParameter($parameter, $profile);
        $groupWasProvided = $request->has('parameter_group_uuid');
        [$attributes, $draftRevision, $groupUuid] = $this->attributes($request->validated());

        $result = $this->authoring->mutate($profile, $request->user(), $draftRevision, function (DeviceProfile $locked) use ($parameter, $attributes, $groupUuid, $groupWasProvided): ProfileParameter {
            /** @var ProfileParameter $editable */
            $editable = $locked->parameters()->whereKey($parameter->getKey())->firstOrFail();
            if ($groupWasProvided) {
                $attributes['parameter_group_id'] = $this->groupId($locked, $groupUuid);
            }
            $editable->fill($attributes)->save();

            return $editable;
        });

        return ProfileParameterResource::make($result['result']->fresh()->load('group'));
    }

    public function destroy(UpsertProfileParameterRequest $request, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): Response
    {
        $this->authorize($request->user(), $organization, $profile);
        $this->ensureParameter($parameter, $profile);
        $draftRevision = $request->validated()['draft_revision'];
        $this->authoring->mutate($profile, $request->user(), $draftRevision, static function (DeviceProfile $locked) use ($parameter): void {
            $editable = $locked->parameters()->whereKey($parameter->getKey())->firstOrFail();
            $references = [
                ...$editable->calculationInputs()->with('calculation.target')->get()->map(fn ($input) => ['kind' => 'calculation', 'uuid' => $input->calculation->uuid, 'label' => $input->calculation->target->label])->all(),
                ...$editable->alarmTemplateParameters()->with('template')->get()->map(fn ($ref) => ['kind' => 'alarm_template', 'uuid' => $ref->template->uuid, 'label' => $ref->template->name])->all(),
                ...$editable->bindingMappings()->with('binding')->get()->map(fn ($mapping) => ['kind' => 'transport_binding', 'uuid' => $mapping->binding->uuid, 'label' => $mapping->binding->adapter_key])->all(),
            ];
            if ($references !== []) {
                throw new HttpResponseException(response()->json([
                    'message' => 'Remove these references before deleting this parameter.',
                    'code' => 'parameter.referenced', 'references' => $references,
                ], 422));
            }
            $editable->delete();
        });

        return response()->noContent();
    }

    public function reorder(ReorderProfileParametersRequest $request, Organization $organization, DeviceProfile $profile): Response
    {
        $this->authorize($request->user(), $organization, $profile);
        $validated = $request->validated();

        $this->authoring->mutate($profile, $request->user(), $validated['draft_revision'], static function (DeviceProfile $locked) use ($validated): null {
            $parameters = $locked->parameters()->get()->keyBy('uuid');
            $requested = $validated['parameter_uuids'];

            if (count($requested) !== $parameters->count() || array_diff($requested, $parameters->keys()->all()) !== []) {
                throw ValidationException::withMessages(['parameter_uuids' => 'The order must contain every parameter exactly once.']);
            }

            foreach ($requested as $sortOrder => $uuid) {
                $parameters[$uuid]->update(['sort_order' => $sortOrder]);
            }

            return null;
        });

        return response()->noContent();
    }

    private function authorize($user, Organization $organization, DeviceProfile $profile): void
    {
        $this->authorization->authorize($user, DeviceProfilePermission::UPDATE);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
    }

    private function ensureParameter(ProfileParameter $parameter, DeviceProfile $profile): void
    {
        abort_unless($parameter->device_profile_id === $profile->getKey(), 404);
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array{0: array<string, mixed>, 1: int, 2: string|null}
     */
    private function attributes(array $validated): array
    {
        $draftRevision = $validated['draft_revision'];
        $groupUuid = $validated['parameter_group_uuid'] ?? null;
        unset($validated['draft_revision'], $validated['parameter_group_uuid']);

        return [$validated, $draftRevision, $groupUuid];
    }

    private function groupId(DeviceProfile $profile, ?string $groupUuid): ?int
    {
        if ($groupUuid === null) {
            return null;
        }

        return ProfileParameterGroup::query()
            ->where('device_profile_id', $profile->getKey())
            ->where('uuid', $groupUuid)
            ->value('id') ?? throw ValidationException::withMessages([
                'parameter_group_uuid' => 'The parameter group must belong to this profile.',
            ]);
    }
}
