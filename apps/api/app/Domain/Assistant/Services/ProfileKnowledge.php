<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\DeviceProfiles\Http\Requests\StoreDeviceProfileRequest;
use App\Domain\DeviceProfiles\Http\Requests\StoreProfileParameterGroupRequest;
use App\Domain\DeviceProfiles\Http\Requests\UpsertProfileParameterRequest;

final class ProfileKnowledge
{
    public function describe(): array
    {
        $parameter = new UpsertProfileParameterRequest;
        $parameter->setMethod('POST');
        $rules = $parameter->rules();
        $rules['kind'] = ['required', 'state|measurement|counter|event|derived'];
        $rules['data_type'] = ['required', 'boolean|integer|number|enum|string|timestamp|bytes'];

        return [
            'version' => 2,
            'identity' => (new StoreDeviceProfileRequest)->rules(),
            'parameters' => $rules,
            'ingress_conversion' => ['source_unit' => 'Incoming unit or null for unitless', 'multiplier' => 'Finite nonzero number', 'offset' => 'Finite number', 'equation' => 'stored = incoming * multiplier + offset', 'eligible' => 'Read-only numeric measurements and counters; positive multiplier for monotonic counters',
                'example' => ['source_unit' => 'mL/min', 'multiplier' => 0.001, 'offset' => 0], 'shape' => 'One object in the parameter values, never a list'],
            'counter_config' => ['monotonic' => 'true for cumulative meters such as energy or volume', 'reset_behavior' => 'new_segment (default) or diagnose; a decrease never invalidates readings, diagnose also flags it for review', 'rollover_at' => 'Optional positive value at which the meter wraps to zero; ask only when the documentation states a maximum register value'],
            'groups' => (new StoreProfileParameterGroupRequest)->rules(),
            'calculations' => ['target_uuid' => 'Existing derived parameter UUID in the change envelope, or null when output is supplied', 'output' => ['key' => 'New stable key', 'label' => 'New output label', 'data_type' => 'number|integer', 'unit' => 'Output unit or null', 'parameter_group_uuid' => 'Existing group UUID or null'], 'engine' => 'json_logic', 'expression' => 'Restricted JSON Logic arithmetic using input aliases', 'inputs' => [['parameter_uuid' => 'Existing input UUID', 'alias' => 'Unique name']], 'trigger' => 'on_input_change', 'failure_policy' => 'mark_invalid'],
            'new_calculation_example' => [
                'section' => 'calculations', 'summary' => 'Create an additional calculated output',
                'changes' => [['operation' => 'upsert', 'uuid' => null, 'values' => [
                    'output' => ['key' => 'calculated_power', 'label' => 'Calculated power', 'data_type' => 'number', 'unit' => 'kW', 'parameter_group_uuid' => null],
                    'engine' => 'json_logic', 'expression' => ['*' => [['var' => 'power'], 3]],
                    'inputs' => [['parameter_uuid' => 'REPLACE_WITH_EXISTING_INPUT_UUID_FROM_READ_TARGET', 'alias' => 'power']],
                    'trigger' => 'on_input_change', 'failure_policy' => 'mark_invalid',
                ]]],
            ],
            'required_questions' => ['Device purpose and model/variant where relevant', 'Profile name and code', 'At least one parameter: meaning, label/key, kind and data type', 'Physical units or explicit unitless values when applicable', 'Whether each state is reported and whether it can accept commands'],
            'conditional_questions' => ['Allowed states/ranges when commands are requested', 'Convert one incoming measurement or calculate another value?', 'Incoming unit, stored unit, and confirmed multiplier/offset when converting', 'Formula, named existing inputs, and new or existing output for derived values', 'Resolve ambiguous or conflicting source facts'],
            'optional_questions' => ['Description and category', 'Parameter groups', 'Display precision, widget and step', 'Sample values and validation limits', 'Counter reset/monotonic behavior', 'Reporting freshness (not an offline alarm)'],
            'operation_shape' => ['operation' => 'upsert|remove', 'uuid' => 'Existing item UUID, or null to create', 'values' => 'Object containing editable fields only; empty object for remove'],
            'notes' => ['Approve identity first to create the profile.', 'Parameters and groups use real UUIDs returned after saving.', 'For calculations, uuid is the target parameter UUID, or null with output details to create the output and formula atomically.', 'draft_revision is bound by the server; never put it in values.', 'Omitted fields are preserved; removal must be explicit.', 'Unit labels never convert numbers. Parameter ingress_conversion stores only the normalized measurement. Device overrides are configured manually. Never infer an unconfirmed conversion.', 'Alarm templates, publication, bindings, live controls and device activation are unavailable.'],
            'validation_example' => ['engine' => 'json_logic', 'rule' => ['and' => [['>=' => [['var' => 'value'], 0]], ['<=' => [['var' => 'value'], 100]]]], 'diagnostic_code' => 'out_of_range', 'message' => 'Use a value between 0 and 100.'],
            'calculation_example' => ['*' => [['var' => 'voltage'], ['var' => 'current']]],
        ];
    }
}
