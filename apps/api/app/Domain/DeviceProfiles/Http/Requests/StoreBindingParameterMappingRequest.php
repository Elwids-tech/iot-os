<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreBindingParameterMappingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'parameter_uuid' => ['required', 'uuid'],
            'direction' => ['required', Rule::in(['ingress', 'egress', 'bidirectional'])],
            'transport_locator' => ['required', 'array'],
            'codec_config' => ['nullable', 'array'],
            'transform_config' => ['nullable', 'array'],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
