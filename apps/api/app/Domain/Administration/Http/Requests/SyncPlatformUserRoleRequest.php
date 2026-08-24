<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class SyncPlatformUserRoleRequest extends FormRequest
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
            'is_platform_administrator' => ['required', 'boolean'],
        ];
    }
}
