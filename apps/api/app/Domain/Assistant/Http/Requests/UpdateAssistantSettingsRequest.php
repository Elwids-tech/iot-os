<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

final class UpdateAssistantSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return (bool) $this->user()?->is_super_admin;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'provider' => ['required', 'string', Rule::in(array_keys(config('assistant.providers')))],
            'model' => ['required', 'string', Rule::in(array_keys(config('assistant.providers.'.$this->string('provider').'.models', [])))],
            'daily_budget_usd' => ['present', 'nullable', 'numeric', 'min:0.01', 'max:10000'],
            'run_budget_usd' => ['present', 'nullable', 'numeric', 'min:0.001', 'max:1000'],
            'revision' => ['required', 'integer', 'min:0'],
            'api_key' => ['sometimes', 'nullable', 'string', 'min:20', 'max:500', 'not_regex:/\s/'],
        ];
    }

    /**
     * @return array<int, callable>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $daily = $this->input('daily_budget_usd') ?? config('assistant.daily_budget_usd');
                $run = $this->input('run_budget_usd') ?? config('assistant.run_budget_usd');
                if (is_numeric($daily) && is_numeric($run) && (float) $run > (float) $daily) {
                    $validator->errors()->add('run_budget_usd', 'The per-reply limit cannot be larger than the daily limit.');
                }
            },
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'model.in' => 'Choose one of the listed models for this provider.',
            'api_key.not_regex' => 'The API key cannot contain spaces or line breaks.',
        ];
    }
}
