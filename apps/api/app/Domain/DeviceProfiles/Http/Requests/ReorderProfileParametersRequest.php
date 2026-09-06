<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class ReorderProfileParametersRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'parameter_uuids' => ['required', 'array'],
            'parameter_uuids.*' => ['required', 'uuid', 'distinct'],
            'draft_revision' => ['required', 'integer', 'min:1'],
        ];
    }
}
