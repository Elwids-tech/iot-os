<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            // Keep me signed in (spec 033, FR-011a): this browser stays signed in for 30 days.
            'remember' => ['sometimes', 'boolean'],
        ];
    }
}
