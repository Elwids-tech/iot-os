<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class StoreDeviceProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:255', 'regex:/^[a-z0-9][a-z0-9.-]*$/'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'category' => ['nullable', 'string', 'max:255'],
            'extensions' => ['nullable', 'array'],
            'status' => ['prohibited'],
            'organization_id' => ['prohibited'],
        ];
    }
}
