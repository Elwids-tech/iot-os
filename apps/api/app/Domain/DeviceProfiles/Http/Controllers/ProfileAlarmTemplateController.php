<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Http\Requests\UpsertProfileAlarmTemplateRequest;
use App\Domain\DeviceProfiles\Http\Resources\ProfileAlarmTemplateResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileAlarmTemplate;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

final class ProfileAlarmTemplateController
{
    public function __construct(
        private readonly DeviceProfileAuthorization $authorization,
        private readonly DeviceProfileAuthoring $authoring,
    ) {}

    public function store(UpsertProfileAlarmTemplateRequest $request, Organization $organization, DeviceProfile $profile): JsonResponse
    {
        $this->authorize($request->user(), $organization, $profile);
        [$attributes, $references, $draftRevision] = $this->attributes($request->validated());

        $result = $this->authoring->mutate($profile, $request->user(), $draftRevision, function (DeviceProfile $locked) use ($attributes, $references): ProfileAlarmTemplate {
            $template = $locked->alarmTemplates()->create($attributes);
            $this->replaceReferences($locked, $template, $references);

            return $template;
        });

        return ProfileAlarmTemplateResource::make($result['result']->load('parameterReferences.parameter'))->response()->setStatusCode(201);
    }

    public function update(UpsertProfileAlarmTemplateRequest $request, Organization $organization, DeviceProfile $profile, ProfileAlarmTemplate $alarm): ProfileAlarmTemplateResource
    {
        $this->authorize($request->user(), $organization, $profile);
        $this->ensureAlarm($alarm, $profile);
        [$attributes, $references, $draftRevision] = $this->attributes($request->validated());
        $replaceReferences = $request->has('parameter_references');

        $result = $this->authoring->mutate($profile, $request->user(), $draftRevision, function (DeviceProfile $locked) use ($alarm, $attributes, $references, $replaceReferences): ProfileAlarmTemplate {
            /** @var ProfileAlarmTemplate $editable */
            $editable = $locked->alarmTemplates()->whereKey($alarm->getKey())->firstOrFail();
            $editable->fill($attributes)->save();
            if ($replaceReferences) {
                $this->replaceReferences($locked, $editable, $references);
            }

            return $editable;
        });

        return ProfileAlarmTemplateResource::make($result['result']->fresh()->load('parameterReferences.parameter'));
    }

    public function destroy(UpsertProfileAlarmTemplateRequest $request, Organization $organization, DeviceProfile $profile, ProfileAlarmTemplate $alarm): Response
    {
        $this->authorize($request->user(), $organization, $profile);
        $this->ensureAlarm($alarm, $profile);
        $draftRevision = $request->validated()['draft_revision'];

        $this->authoring->mutate($profile, $request->user(), $draftRevision, static function (DeviceProfile $locked) use ($alarm): null {
            $locked->alarmTemplates()->whereKey($alarm->getKey())->delete();

            return null;
        });

        return response()->noContent();
    }

    private function authorize($user, Organization $organization, DeviceProfile $profile): void
    {
        $this->authorization->authorize($user, DeviceProfilePermission::UPDATE);
        $this->authorization->ensureOrganizationProfile($profile, $organization);
    }

    private function ensureAlarm(ProfileAlarmTemplate $alarm, DeviceProfile $profile): void
    {
        abort_unless($alarm->device_profile_id === $profile->getKey(), 404);
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array{0: array<string, mixed>, 1: list<array{parameter_uuid: string, role: string}>, 2: int}
     */
    private function attributes(array $validated): array
    {
        $references = $validated['parameter_references'] ?? [];
        $draftRevision = $validated['draft_revision'];
        unset($validated['parameter_references'], $validated['draft_revision']);

        return [$validated, $references, $draftRevision];
    }

    /**
     * @param  list<array{parameter_uuid: string, role: string}>  $references
     */
    private function replaceReferences(DeviceProfile $profile, ProfileAlarmTemplate $template, array $references): void
    {
        $parameters = $profile->parameters()->whereIn('uuid', array_column($references, 'parameter_uuid'))->get()->keyBy('uuid');
        if ($parameters->count() !== count($references)) {
            throw ValidationException::withMessages(['parameter_references' => 'Every alarm template parameter must belong to this profile.']);
        }

        $template->parameterReferences()->delete();
        foreach ($references as $reference) {
            $template->parameterReferences()->create([
                'profile_parameter_id' => $parameters[$reference['parameter_uuid']]->getKey(),
                'role' => $reference['role'],
            ]);
        }
    }
}
