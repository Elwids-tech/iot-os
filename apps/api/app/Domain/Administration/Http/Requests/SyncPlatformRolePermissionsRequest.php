<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class SyncPlatformRolePermissionsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string>|array<int, string>>
     */
    public function rules(): array
    {
        return [
            'permission_names' => ['present', 'array'],
            'permission_names.*' => ['string', 'max:255'],
        ];
    }
}
