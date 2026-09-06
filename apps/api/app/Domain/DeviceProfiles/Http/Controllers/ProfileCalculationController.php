<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Http\Requests\DeleteProfileCalculationRequest;
use App\Domain\DeviceProfiles\Http\Requests\UpsertProfileCalculationRequest;
use App\Domain\DeviceProfiles\Http\Resources\ProfileParameterResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileCalculation;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

final class ProfileCalculationController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly DeviceProfileAuthoring $authoring,
    ) {}

    public function upsert(UpsertProfileCalculationRequest $request, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): ProfileParameterResource
    {
        $this->authorize($request->user(), $organization, $profile, $parameter);
        abort_unless($parameter->kind === ProfileParameterKind::DERIVED, 422, 'Only derived parameters can be calculation targets.');
        $validated = $request->validated();

        $result = $this->authoring->mutate($profile, $request->user(), $validated['draft_revision'], function (DeviceProfile $locked) use ($parameter, $validated): ProfileParameter {
            /** @var ProfileParameter $target */
            $target = $locked->parameters()->whereKey($parameter->getKey())->firstOrFail();
            $calculation = ProfileCalculation::query()->updateOrCreate(
                ['target_profile_parameter_id' => $target->getKey()],
                [
                    'device_profile_id' => $locked->getKey(),
                    'engine' => $validated['engine'],
                    'expression' => $validated['expression'],
                    'trigger' => $validated['trigger'] ?? 'on_input_change',
                    'failure_policy' => $validated['failure_policy'] ?? 'mark_invalid',
                ],
            );
            $calculation->inputs()->delete();
            $parameters = $locked->parameters()->whereIn('uuid', array_column($validated['inputs'], 'parameter_uuid'))->get()->keyBy('uuid');

            foreach ($validated['inputs'] as $input) {
                $source = $parameters->get($input['parameter_uuid']);
                if ($source === null) {
                    throw ValidationException::withMessages(['inputs' => 'Every calculation input must belong to this profile.']);
                }
                $calculation->inputs()->create([
                    'profile_parameter_id' => $source->getKey(),
                    'alias' => $input['alias'],
                ]);
            }

            return $target;
        });

        return ProfileParameterResource::make($result['result']->fresh()->load('calculation.inputs.parameter'));
    }

    public function destroy(DeleteProfileCalculationRequest $request, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): Response
    {
        $this->authorize($request->user(), $organization, $profile, $parameter);
        $draftRevision = $request->validated()['draft_revision'];

        $this->authoring->mutate($profile, $request->user(), $draftRevision, static function (DeviceProfile $locked) use ($parameter): null {
            $locked->calculations()->where('target_profile_parameter_id', $parameter->getKey())->delete();

            return null;
        });

        return response()->noContent();
    }

    private function authorize($user, Organization $organization, DeviceProfile $profile, ProfileParameter $parameter): void
    {
        $this->authorization->authorize($user, DeviceProfilePermission::UPDATE);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
        abort_unless($parameter->device_profile_id === $profile->getKey(), 404);
    }
}
