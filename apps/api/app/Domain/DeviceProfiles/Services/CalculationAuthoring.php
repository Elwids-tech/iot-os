<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileCalculation;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use Illuminate\Support\Arr;
use Illuminate\Validation\ValidationException;

final class CalculationAuthoring
{
    /** Called inside the profile authoring transaction, including assistant proposal previews. */
    public function save(DeviceProfile $profile, array $values, ?ProfileParameter $target = null): ProfileParameter
    {
        if ($target === null) {
            $output = $values['output'] ?? null;
            if (! is_array($output)) {
                throw ValidationException::withMessages(['output' => 'Define the new calculated output.']);
            }
            $group = $output['parameter_group_uuid'] ?? null;
            $groupId = $group ? $profile->parameterGroups()->where('uuid', $group)->firstOrFail()->id : null;
            $target = $profile->parameters()->create([
                ...Arr::only($output, ['key', 'label', 'data_type', 'unit']),
                'kind' => 'derived', 'reports_state' => true, 'accepts_command' => false,
                'parameter_group_id' => $groupId,
                'sort_order' => ($profile->parameters()->max('sort_order') ?? -1) + 1,
            ]);
        } else {
            abort_unless($target->device_profile_id === $profile->id && $target->kind === ProfileParameterKind::DERIVED, 422, 'Choose a derived output from this profile.');
            if (isset($values['output'])) {
                throw ValidationException::withMessages(['output' => 'An existing output cannot also create another output.']);
            }
        }
        $calculation = ProfileCalculation::query()->updateOrCreate(['target_profile_parameter_id' => $target->id], [
            'device_profile_id' => $profile->id, 'engine' => $values['engine'], 'expression' => $values['expression'],
            'trigger' => $values['trigger'] ?? 'on_input_change', 'failure_policy' => $values['failure_policy'] ?? 'mark_invalid',
        ]);
        $calculation->inputs()->delete();
        foreach ($values['inputs'] as $input) {
            $source = $profile->parameters()->where('uuid', $input['parameter_uuid'])->first();
            if (! $source || $source->id === $target->id) {
                throw ValidationException::withMessages(['inputs' => 'Choose other parameters from this profile as inputs.']);
            }
            $calculation->inputs()->create(['profile_parameter_id' => $source->id, 'alias' => $input['alias']]);
        }
        $diagnostics = app(CalculationGraphValidator::class)->validate($profile->fresh());
        if ($diagnostics !== []) {
            throw ValidationException::withMessages(['expression' => array_map(fn ($diagnostic) => $diagnostic->message, $diagnostics)]);
        }

        return $target->fresh()->load(['group', 'calculation.inputs.parameter']);
    }
}
