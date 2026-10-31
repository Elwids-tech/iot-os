<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Http\Requests\StoreProfileParameterGroupRequest;
use App\Domain\DeviceProfiles\Http\Resources\ProfileParameterGroupResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileParameterGroup;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

final class ProfileParameterGroupController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly DeviceProfileAuthoring $authoring,
    ) {}

    public function store(StoreProfileParameterGroupRequest $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::UPDATE);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
        $validated = $request->validated();
        $draftRevision = $validated['draft_revision'];
        unset($validated['draft_revision']);

        $result = $this->authoring->mutate(
            $profile,
            $request->user(),
            $draftRevision,
            static fn (DeviceProfile $locked): ProfileParameterGroup => $locked->parameterGroups()->create($validated), change: 'parameter_group.created',
        );

        return ProfileParameterGroupResource::make($result['result'])->response()->setStatusCode(201);
    }

    public function update(Request $request, Organization $organization, DeviceProfile $profile, ProfileParameterGroup $group): ProfileParameterGroupResource
    {
        $this->authorizeGroup($request, $organization, $profile, $group);
        $values = $request->validate([
            'code' => ['sometimes', 'string', 'max:255', 'regex:/^[a-z0-9][a-z0-9.-]*$/'],
            'label' => ['sometimes', 'string', 'max:255'], 'description' => ['nullable', 'string'],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ]);
        $revision = $values['draft_revision'];
        unset($values['draft_revision']);
        $result = $this->authoring->mutate($profile, $request->user(), $revision, function ($locked) use ($group, $values) {
            $editable = $locked->parameterGroups()->whereKey($group->getKey())->firstOrFail();
            $editable->update($values);

            return $editable;
        }, change: 'parameter_group.updated', item: $group);

        return ProfileParameterGroupResource::make($result['result']);
    }

    public function destroy(Request $request, Organization $organization, DeviceProfile $profile, ProfileParameterGroup $group): Response
    {
        $this->authorizeGroup($request, $organization, $profile, $group);
        $revision = $request->validate(['draft_revision' => ['required', 'integer', 'min:1']])['draft_revision'];
        $this->authoring->mutate($profile, $request->user(), $revision, function ($locked) use ($group): void {
            $editable = $locked->parameterGroups()->whereKey($group->getKey())->firstOrFail();
            $editable->parameters()->update(['parameter_group_id' => null]);
            $editable->delete();
        }, change: 'parameter_group.deleted', item: $group);

        return response()->noContent();
    }

    public function reorder(Request $request, Organization $organization, DeviceProfile $profile): Response
    {
        $this->authorizeGroup($request, $organization, $profile);
        $values = $request->validate(['draft_revision' => ['required', 'integer', 'min:1'], 'group_uuids' => ['present', 'array'], 'group_uuids.*' => ['uuid', 'distinct']]);
        $this->authoring->mutate($profile, $request->user(), $values['draft_revision'], function ($locked) use ($values): void {
            $groups = $locked->parameterGroups()->get()->keyBy('uuid');
            if (count($values['group_uuids']) !== $groups->count() || array_diff($values['group_uuids'], $groups->keys()->all()) !== []) {
                throw ValidationException::withMessages(['group_uuids' => 'Include every group exactly once.']);
            }
            foreach ($values['group_uuids'] as $index => $uuid) {
                $groups[$uuid]->update(['sort_order' => $index]);
            }
        }, change: 'parameter_groups.reordered');

        return response()->noContent();
    }

    private function authorizeGroup(Request $request, Organization $organization, DeviceProfile $profile, ?ProfileParameterGroup $group = null): void
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::UPDATE);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
        if ($group !== null) {
            abort_unless($group->device_profile_id === $profile->getKey(), 404);
        }
    }
}
