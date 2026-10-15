<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class TestAssistantConnectionRequest extends FormRequest
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
            'api_key' => ['sometimes', 'nullable', 'string', 'min:20', 'max:500', 'not_regex:/\s/'],
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
