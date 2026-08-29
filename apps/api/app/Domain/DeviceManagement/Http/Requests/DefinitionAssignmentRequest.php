<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DefinitionAssignmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'profile_version_uuid' => ['required', 'uuid'],
            'binding_version_uuid' => ['required', 'uuid'],
        ];
    }
}
