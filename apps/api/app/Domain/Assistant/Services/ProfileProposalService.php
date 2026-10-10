<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantProposal;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\DeviceProfiles\Actions\CreateDeviceProfile;
use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Exceptions\ProfileDraftConflictException;
use App\Domain\DeviceProfiles\Http\Requests\StoreDeviceProfileRequest;
use App\Domain\DeviceProfiles\Http\Requests\StoreProfileParameterGroupRequest;
use App\Domain\DeviceProfiles\Http\Requests\UpsertProfileCalculationRequest;
use App\Domain\DeviceProfiles\Http\Requests\UpsertProfileParameterRequest;
use App\Domain\DeviceProfiles\Http\Resources\DeviceProfileResource;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\CalculationAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileValidator;
use App\Domain\DeviceProfiles\Services\ProfileConfigurationValidator;
use App\Domain\DeviceProfiles\Services\PublishedParameters;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

final class ProfileProposalService
{
    public function snapshot(?DeviceProfile $profile): array
    {
        if ($profile === null) {
            return [];
        }
        $profile->load(['parameterGroups', 'parameters.group', 'parameters.calculation.inputs.parameter', 'alarmTemplates.parameterReferences.parameter']);

        return DeviceProfileResource::make($profile)->resolve();
    }

    public function preview(AssistantConversation $conversation, array $input, ?AssistantRun $run = null): AssistantProposal
    {
        app(AssistantAccess::class)->write($conversation);
        $data = Validator::make($input, [
            'section' => ['required', 'in:identity,parameters,groups,calculations'],
            'summary' => ['required', 'string', 'max:255'],
            'changes' => ['required', 'array', 'min:1', 'max:100'],
            'evidence' => ['sometimes', 'array', 'max:100'],
            'evidence.*.field' => ['required', 'string', 'max:255'],
            'evidence.*.origin' => ['required', 'in:user_confirmed,source,suggested,unresolved'],
            'evidence.*.source_id' => ['nullable', 'uuid'],
            'evidence.*.location' => ['nullable', 'string', 'max:255'],
            'evidence.*.note' => ['nullable', 'string', 'max:1000'],
        ])->validate();
        foreach ($data['evidence'] ?? [] as $evidence) {
            if (! empty($evidence['source_id'])) {
                abort_unless($conversation->sources()->whereKey($evidence['source_id'])->exists(), 422, 'A cited source is unavailable in this conversation.');
            }
        }
        abort_if($conversation->device_profile_id === null && $data['section'] !== 'identity', 422, 'Approve the profile identity before adding its sections.');
        if ($data['section'] === 'identity') {
            abort_unless(count($data['changes']) === 1, 422, 'Identity proposals contain one change.');
        }

        return DB::transaction(function () use ($conversation, $data, $run): AssistantProposal {
            $locked = AssistantConversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $profile = $locked->device_profile_id ? DeviceProfile::query()->lockForUpdate()->findOrFail($locked->device_profile_id) : null;
            $before = $this->snapshot($profile);
            $changes = $this->validateChanges($data['section'], $data['changes'], $profile);
            DB::beginTransaction();
            try {
                $candidate = $this->writeChanges($locked, $data['section'], $changes);
                $diagnostics = array_map(fn ($item) => $item->toArray(), app(DeviceProfileValidator::class)->validate($candidate));
            } finally {
                DB::rollBack();
            }
            $incomplete = ['profile.no_parameters', 'calculation.missing_expression'];
            $diagnostics = array_map(fn ($item) => [...$item, 'blocking' => ! in_array($item['code'], $incomplete, true)], $diagnostics);
            foreach ($data['evidence'] ?? [] as $item) {
                if ($item['origin'] === 'unresolved') {
                    $diagnostics[] = ['code' => 'assistant.unresolved', 'message' => $item['note'] ?? 'Resolve this proposed value before applying.', 'pointer' => $item['field'], 'blocking' => true];
                }
            }
            $locked->proposals()->where('status', 'pending')->where('section', $data['section'])->update(['status' => 'superseded']);
            $proposal = $locked->proposals()->create([
                'run_id' => $run?->id, 'section' => $data['section'], 'summary' => $data['summary'],
                'draft_revision' => $profile?->draft_revision, 'changes' => $changes, 'before' => $before,
                'evidence' => $data['evidence'] ?? [], 'diagnostics' => $diagnostics,
                'content_hash' => hash('sha256', app(CanonicalJson::class)->encode([$locked->id, $profile?->uuid, $profile?->draft_revision, $data['section'], $changes])),
            ]);
            app(AssistantEvents::class)->emit($locked, $run, 'proposal', ['proposal_id' => $proposal->id]);

            return $proposal;
        });
    }

    public function apply(AssistantProposal $proposal, string $hash): array
    {
        return DB::transaction(function () use ($proposal, $hash): array {
            $proposal = AssistantProposal::query()->lockForUpdate()->findOrFail($proposal->id);
            $conversation = AssistantConversation::query()->lockForUpdate()->findOrFail($proposal->conversation_id);
            app(AssistantAccess::class)->write($conversation);
            abort_unless(hash_equals($proposal->content_hash, $hash), 409, 'The reviewed proposal has changed.');
            if ($proposal->status === 'applied') {
                return $proposal->result;
            }
            abort_unless($proposal->status === 'approved', 409, 'This proposal has not been approved.');
            abort_if(collect($proposal->diagnostics)->contains(fn ($d) => $d['blocking'] ?? false), 422, 'Resolve the proposal issues first.');
            $profile = $conversation->profile;
            if ($profile === null && $proposal->draft_revision !== null) {
                throw new ProfileDraftConflictException;
            }
            if ($profile !== null) {
                $result = app(DeviceProfileAuthoring::class)->mutate($profile, $conversation->user, $proposal->draft_revision, fn () => $this->writeChanges($conversation, $proposal->section, $proposal->changes));
                $profile = $result['profile'];
            } else {
                $profile = $this->writeChanges($conversation, $proposal->section, $proposal->changes);
                $conversation->update(['device_profile_id' => $profile->id, 'title' => $profile->name]);
            }
            $saved = ['profile_uuid' => $profile->uuid, 'draft_revision' => $profile->draft_revision, 'profile_name' => $profile->name];
            $proposal->update(['status' => 'applied', 'result' => $saved]);
            DB::table('assistant_profile_audits')->insert([
                'organization_id' => $conversation->organization_id, 'user_id' => $conversation->user_id,
                'device_profile_id' => $profile->id, 'proposal_id' => $proposal->id, 'content_hash' => $hash,
                'draft_revision' => $profile->draft_revision, 'changes' => json_encode($proposal->changes, JSON_THROW_ON_ERROR), 'created_at' => now(),
            ]);
            app(AssistantEvents::class)->emit($conversation, null, 'saved', [...$saved, 'proposal_id' => $proposal->id, 'summary' => $proposal->summary]);

            return $saved;
        });
    }

    private function validateChanges(string $section, array $changes, ?DeviceProfile $profile): array
    {
        return array_map(function (array $change) use ($section): array {
            $envelope = Validator::make($change, [
                'operation' => ['required', 'in:upsert,remove'], 'uuid' => ['nullable', 'uuid'],
                'values' => ['present', 'array'],
            ])->validate();
            $values = $envelope['values'];
            if ($envelope['operation'] === 'remove') {
                abort_if($section === 'identity' || empty($envelope['uuid']) || $values !== [], 422, 'Removal must name an existing item and have no replacement values.');

                return $envelope;
            }
            $request = match ($section) {
                'identity' => new StoreDeviceProfileRequest,
                'parameters' => new UpsertProfileParameterRequest,
                'groups' => new StoreProfileParameterGroupRequest,
                'calculations' => new UpsertProfileCalculationRequest,
            };
            $request->setMethod('POST');
            $rules = $request->rules();
            unset($rules['draft_revision']);
            if ($section === 'identity') {
                unset($rules['extensions']);
            }
            $allowed = array_unique(array_map(fn ($key) => explode('.', $key)[0], array_keys($rules)));
            $unsupported = array_values(array_diff(array_keys($values), $allowed));
            if ($unsupported !== []) {
                $hint = $section === 'calculations'
                    ? 'For a new output, nest key, label, data_type, unit, and parameter_group_uuid inside values.output. Put engine, expression, inputs, trigger, and failure_policy directly in values. Do not use values.calculation.'
                    : 'Use only editable fields from the schema tool.';
                throw ValidationException::withMessages(['values' => 'Unsupported fields: '.implode(', ', $unsupported).'. '.$hint]);
            }
            $values = Validator::make($values, $rules)->validate();
            if ($section === 'parameters') {
                $errors = app(ProfileConfigurationValidator::class)->errors($values);
                if ($errors !== []) {
                    throw ValidationException::withMessages($errors);
                }
                $values['reports_state'] = $values['reports_state'] ?? true;
                $values['accepts_command'] = $values['accepts_command'] ?? false;
                abort_if($values['accepts_command'] && $values['kind'] !== 'state', 422, 'Only state parameters can be proposed as commandable.');
            }
            if ($section === 'calculations') {
                abort_if(empty($envelope['uuid']) && empty($values['output']), 422, 'Choose an existing derived output or define a new output.');
                abort_if(! empty($envelope['uuid']) && isset($values['output']), 422, 'Choose an existing output or create a new one, not both.');
            }

            return [...$envelope, 'values' => $values];
        }, $changes);
    }

    private function writeChanges(AssistantConversation $conversation, string $section, array $changes): DeviceProfile
    {
        $profile = $conversation->profile?->fresh();
        if ($section === 'identity') {
            $attributes = $changes[0]['values'];
            if ($profile === null) {
                return app(CreateDeviceProfile::class)->handle($conversation->organization, $conversation->user, $attributes);
            }
            $profile->update($attributes);

            return $profile->fresh();
        }
        abort_unless($profile !== null, 422);
        foreach ($changes as $change) {
            $uuid = $change['uuid'] ?? null;
            $values = $change['values'];
            if ($section === 'parameters') {
                $parameter = $uuid ? $profile->parameters()->where('uuid', $uuid)->firstOrFail() : null;
                if ($change['operation'] === 'remove') {
                    abort_if($parameter->calculationInputs()->exists() || $parameter->alarmTemplateParameters()->exists() || $parameter->bindingMappings()->exists(), 422, 'This parameter is still referenced by calculations, alarm templates, or mappings.');
                    $parameter->delete();

                    continue;
                }
                if (array_key_exists('parameter_group_uuid', $values)) {
                    $values['parameter_group_id'] = $values['parameter_group_uuid'] === null ? null : $profile->parameterGroups()->where('uuid', $values['parameter_group_uuid'])->firstOrFail()->id;
                    unset($values['parameter_group_uuid']);
                }
                $values = app(PublishedParameters::class)->guard($profile, $parameter, $values);
                $parameter ? $parameter->update($values) : $profile->parameters()->create($values);
            } elseif ($section === 'groups') {
                $group = $uuid ? $profile->parameterGroups()->where('uuid', $uuid)->firstOrFail() : null;
                if ($change['operation'] === 'remove') {
                    $group->parameters()->update(['parameter_group_id' => null]);
                    $group->delete();
                } else {
                    $group ? $group->update($values) : $profile->parameterGroups()->create($values);
                }
            } else {
                $parameter = $uuid ? $profile->parameters()->where('uuid', $uuid)->firstOrFail() : null;
                if ($change['operation'] === 'remove') {
                    abort_unless($parameter?->kind === ProfileParameterKind::DERIVED, 422, 'Choose a derived output.');
                    $parameter->calculation?->delete();

                    continue;
                }
                app(CalculationAuthoring::class)->save($profile, $values, $parameter);
            }
        }

        return $profile->fresh();
    }
}
