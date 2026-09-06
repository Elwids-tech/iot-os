<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreTransportBindingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'adapter_key' => ['required', 'string', 'max:255', 'regex:/^[a-z0-9][a-z0-9._-]*$/'],
            'name' => ['required', 'string', 'max:255'],
            'adapter_config' => ['nullable', 'array'],
            'status' => ['nullable', Rule::in(['draft', 'active', 'archived'])],
            'compile_status' => ['nullable', Rule::in(['pending', 'valid', 'invalid'])],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
