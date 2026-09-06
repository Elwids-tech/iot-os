<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class UpsertProfileAlarmTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $required = $this->isMethod('post') ? 'required' : 'sometimes';

        return [
            'code' => [$required, 'string', 'max:255', 'regex:/^[a-z0-9][a-z0-9.-]*$/'],
            'name' => [$required, 'string', 'max:255'],
            'type' => [$required, 'string', 'max:255'],
            'severity' => [$required, 'string', 'max:255'],
            'condition_config' => [$required, 'array'],
            'enabled_by_default' => ['sometimes', 'boolean'],
            'parameter_references' => ['nullable', 'array'],
            'parameter_references.*.parameter_uuid' => ['required_with:parameter_references', 'uuid', 'distinct'],
            'parameter_references.*.role' => ['required_with:parameter_references', 'string', 'max:255'],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
