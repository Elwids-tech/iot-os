<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DeviceDraftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'uuid' => ['sometimes', 'uuid'],
            'name' => ['required', 'string', 'max:160'],
            'external_id' => ['required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'profile_version_uuid' => ['nullable', 'required_with:binding_version_uuid', 'uuid'],
            'binding_version_uuid' => ['nullable', 'required_with:profile_version_uuid', 'uuid'],
        ];
    }
}
