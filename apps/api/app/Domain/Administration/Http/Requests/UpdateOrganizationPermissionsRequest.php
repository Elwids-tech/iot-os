<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class UpdateOrganizationPermissionsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'restricted' => ['required', 'boolean'],
            'permission_names' => ['required_if:restricted,true', 'array'],
            'permission_names.*' => ['string', 'max:255', 'distinct'],
        ];
    }
}
