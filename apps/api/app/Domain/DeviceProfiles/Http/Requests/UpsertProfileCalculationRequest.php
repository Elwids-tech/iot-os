<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class UpsertProfileCalculationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'output' => ['sometimes', 'array:key,label,data_type,unit,parameter_group_uuid'],
            'output.key' => ['required_with:output', 'string', 'max:255', 'regex:/^[a-zA-Z][a-zA-Z0-9._-]*$/'],
            'output.label' => ['required_with:output', 'string', 'max:255'],
            'output.data_type' => ['required_with:output', 'in:number,integer'],
            'output.unit' => ['nullable', 'string', 'max:255'],
            'output.parameter_group_uuid' => ['nullable', 'uuid'],
            'engine' => ['required', Rule::in(['json_logic'])],
            'expression' => ['required', 'array'],
            'trigger' => ['nullable', Rule::in(['on_input_change'])],
            'failure_policy' => ['nullable', Rule::in(['mark_invalid'])],
            'inputs' => ['required', 'array', 'min:1'],
            'inputs.*.parameter_uuid' => ['required', 'uuid', 'distinct'],
            'inputs.*.alias' => ['required', 'string', 'max:255', 'distinct'],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
