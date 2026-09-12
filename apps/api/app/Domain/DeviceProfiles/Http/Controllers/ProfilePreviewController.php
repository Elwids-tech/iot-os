<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Controllers;

use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\DeviceProfiles\Services\IngressConversion;
use App\Domain\DeviceProfiles\Services\JsonLogicValidator;
use App\Domain\DeviceProfiles\Services\RestrictedExpression;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use InvalidArgumentException;

final class ProfilePreviewController
{
    public function __invoke(Request $request, Organization $organization, DeviceProfile $profile, DeviceProfileAuthorization $authorization, DeviceProfileAuthoring $authoring, JsonLogicValidator $validation, RestrictedExpression $expressions): JsonResponse
    {
        $authorization->authorize($request->user(), DeviceProfilePermission::VALIDATE);
        $authorization->ensureOrganizationProfile($profile, $organization);
        $values = $request->validate([
            'kind' => ['required', Rule::in(['validation', 'conversion', 'calculation'])],
            'draft_revision' => ['required', 'integer', 'min:1'],
            'parameter' => ['required_if:kind,validation,conversion', 'array'],
            'parameter.data_type' => ['required_if:kind,validation,conversion', Rule::in(['boolean', 'integer', 'number', 'string', 'timestamp', 'bytes'])],
            'parameter.kind' => ['sometimes', 'in:measurement,counter'],
            'parameter.reports_state' => ['sometimes', 'boolean'],
            'parameter.accepts_command' => ['sometimes', 'boolean'],
            'parameter.counter_config' => ['nullable', 'array'],
            'parameter.ingress_conversion' => ['nullable', 'array:source_unit,multiplier,offset'],
            'parameter.format' => ['nullable', 'string'],
            'parameter.validation_logic' => ['nullable', 'array'],
            'value' => ['present_if:kind,validation,conversion'], 'previous_value' => ['nullable'],
            'output_data_type' => ['sometimes', 'in:boolean,integer,number,string,timestamp,bytes'],
            'expression' => ['required_if:kind,calculation', 'array'],
            'inputs' => ['required_if:kind,calculation', 'array', 'max:100'],
            'inputs.*.parameter_uuid' => ['required', 'uuid', 'distinct'],
            'inputs.*.alias' => ['required', 'string', 'max:255', 'distinct'],
            'samples' => ['required_if:kind,calculation', 'array'],
        ]);

        return $authoring->snapshot($profile, $values['draft_revision'], function (DeviceProfile $locked) use ($values, $validation, $expressions): JsonResponse {
            $diagnostics = [];
            $result = null;
            if (in_array($values['kind'], ['validation', 'conversion'], true)) {
                $parameter = $values['parameter'];
                $value = $values['value'] ?? null;
                if ($values['kind'] === 'conversion') {
                    $value = app(IngressConversion::class)->apply($parameter, $value);
                }
                if (! $this->matchesType($value, $parameter['data_type'])) {
                    $diagnostics[] = new ProfileDiagnostic('preview.type_mismatch', 'The sample must be a '.$parameter['data_type'].' value.', '/value');
                }
                if (($parameter['format'] ?? null) === 'hex_color' && (! is_string($value) || ! preg_match('/^#[0-9a-f]{6}$/i', $value))) {
                    $diagnostics[] = new ProfileDiagnostic('preview.format_mismatch', 'Use a six-digit color such as #3366ff.', '/value');
                }
                $definition = $parameter['validation_logic'] ?? null;
                $diagnostics = [...$diagnostics, ...$validation->validateDefinition($definition, '/parameter/validation_logic')];
                if ($diagnostics === [] && $definition !== null) {
                    $evaluation = $validation->evaluate($definition, $value, $values['previous_value'] ?? null);
                    if (! $evaluation['valid']) {
                        $diagnostics[] = new ProfileDiagnostic($evaluation['diagnostic_code'], $evaluation['message'], '/value');
                    }
                }
                $result = $values['kind'] === 'conversion' ? $value : $diagnostics === [];
            } else {
                $parameters = $locked->parameters()->get()->keyBy('uuid');
                foreach ($values['inputs'] as $input) {
                    $parameter = $parameters->get($input['parameter_uuid']);
                    if ($parameter === null) {
                        $diagnostics[] = new ProfileDiagnostic('calculation.cross_profile_input', 'Choose an input from this profile.', '/inputs');
                    } elseif (! array_key_exists($input['alias'], $values['samples']) || ! $this->matchesType($values['samples'][$input['alias']], $parameter->data_type->value)) {
                        $diagnostics[] = new ProfileDiagnostic('preview.type_mismatch', 'Provide a '.$parameter->data_type->value.' sample for '.$input['alias'].'.', '/samples/'.$input['alias']);
                    }
                }
                $diagnostics = [...$diagnostics, ...$expressions->diagnostics($values['expression'], array_column($values['inputs'], 'alias'), '/expression', 'calculation')];
                if ($diagnostics === []) {
                    try {
                        $result = $expressions->evaluate($values['expression'], $values['samples']);
                        if (isset($values['output_data_type']) && ! $this->matchesType($result, $values['output_data_type'])) {
                            $diagnostics[] = new ProfileDiagnostic('preview.output_type_mismatch', 'The result must fit the output type without rounding.', '/expression');
                        }
                    } catch (InvalidArgumentException $exception) {
                        $diagnostics[] = new ProfileDiagnostic('preview.evaluation_failed', $exception->getMessage(), '/expression');
                    }
                }
            }

            return response()->json(['data' => ['draft_revision' => $locked->draft_revision, 'valid' => $diagnostics === [], 'result' => $result, 'diagnostics' => array_map(fn ($diagnostic) => $diagnostic->toArray(), $diagnostics)]]);
        });
    }

    private function matchesType(mixed $value, string $type): bool
    {
        return match ($type) {
            'boolean' => is_bool($value), 'integer' => (is_int($value) || is_float($value)) && is_finite((float) $value) && floor($value) == $value && abs($value) <= 9007199254740991,
            'number' => is_int($value) || (is_float($value) && is_finite($value)),
            'string' => is_string($value),
            'bytes' => is_string($value) && base64_decode($value, true) !== false,
            'timestamp' => is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}T/', $value) && strtotime($value) !== false,
            default => false,
        };
    }
}
