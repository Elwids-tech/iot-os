<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use App\Domain\DeviceProfiles\Enums\ProfileParameterDataType;
use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Services\ProfileConfigurationValidator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

final class UpsertProfileParameterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function after(): array
    {
        return [function (Validator $validator): void {
            foreach (app(ProfileConfigurationValidator::class)->errors($this->all()) as $field => $messages) {
                foreach ($messages as $message) {
                    $validator->errors()->add($field, $message);
                }
            }
        }];
    }

    public function rules(): array
    {
        $required = $this->isMethod('post') ? 'required' : 'sometimes';

        return [
            'key' => [$required, 'string', 'max:255', 'regex:/^[a-zA-Z][a-zA-Z0-9._-]*$/'],
            'label' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'kind' => [$required, Rule::enum(ProfileParameterKind::class)],
            'data_type' => [$required, Rule::enum(ProfileParameterDataType::class)],
            'format' => ['nullable', 'string', 'max:255'],
            'unit' => ['nullable', 'string', 'max:255'],
            'parameter_group_uuid' => ['nullable', 'uuid'],
            'reports_state' => ['sometimes', 'boolean'],
            'accepts_command' => ['sometimes', 'boolean'],
            'validation_logic' => ['nullable', 'array'],
            'display_config' => ['nullable', 'array'],
            'reporting_config' => ['nullable', 'array'],
            'counter_config' => ['nullable', 'array'],
            'sort_order' => ['nullable', 'integer'],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
