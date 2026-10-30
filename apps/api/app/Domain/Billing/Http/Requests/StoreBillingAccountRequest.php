<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class StoreBillingAccountRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:255'],
            'contact_email' => ['nullable', 'email', 'max:255'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'organization_limit' => ['sometimes', 'integer', 'min:0', 'max:1000'],
        ];
    }
}
