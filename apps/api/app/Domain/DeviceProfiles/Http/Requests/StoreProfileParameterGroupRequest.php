<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class StoreProfileParameterGroupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:255', 'regex:/^[a-z0-9][a-z0-9.-]*$/'],
            'label' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'sort_order' => ['nullable', 'integer'],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
