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
