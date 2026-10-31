<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Http\Requests\DeleteProfileCalculationRequest;
use App\Domain\DeviceProfiles\Http\Requests\UpsertProfileCalculationRequest;
use App\Domain\DeviceProfiles\Http\Resources\ProfileParameterResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\CalculationAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Response;

final class ProfileCalculationController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly DeviceProfileAuthoring $authoring,
    ) {}

    public function store(UpsertProfileCalculationRequest $request, Organization $organization, DeviceProfile $profile): ProfileParameterResource
    {
        $this->authorization->authorize($request->user(), DeviceProfilePermission::UPDATE);
        abort_unless($profile->organization_id === $organization->id, 404);
        $values = $request->validated();
        $result = $this->authoring->mutate($profile, $request->user(), $values['draft_revision'],
            fn (DeviceProfile $locked) => app(CalculationAuthoring::class)->save($locked, $values), change: 'calculation.created');

        return ProfileParameterResource::make($result['result']);
    }

    public function upsert(UpsertProfileCalculationRequest $request, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): ProfileParameterResource
    {
        $this->authorize($request->user(), $organization, $profile, $parameter);
        abort_unless($parameter->kind === ProfileParameterKind::DERIVED, 422, 'Only derived parameters can be calculation targets.');
        $validated = $request->validated();

        $result = $this->authoring->mutate($profile, $request->user(), $validated['draft_revision'], function (DeviceProfile $locked) use ($parameter, $validated): ProfileParameter {
            /** @var ProfileParameter $target */
            $target = $locked->parameters()->whereKey($parameter->getKey())->firstOrFail();

            return app(CalculationAuthoring::class)->save($locked, $validated, $target);
        }, change: 'calculation.saved', item: $parameter);

        return ProfileParameterResource::make($result['result']->fresh()->load('calculation.inputs.parameter'));
    }

    public function destroy(DeleteProfileCalculationRequest $request, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): Response
    {
        $this->authorize($request->user(), $organization, $profile, $parameter);
        $draftRevision = $request->validated()['draft_revision'];

        $this->authoring->mutate($profile, $request->user(), $draftRevision, static function (DeviceProfile $locked) use ($parameter): null {
            $locked->calculations()->where('target_profile_parameter_id', $parameter->getKey())->delete();

            return null;
        }, change: 'calculation.deleted', item: $parameter);

        return response()->noContent();
    }

    private function authorize($user, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): void
    {
        $this->authorization->authorize($user, DeviceProfilePermission::UPDATE);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
        abort_unless($parameter->device_profile_id === $profile->getKey(), 404);
    }
}
