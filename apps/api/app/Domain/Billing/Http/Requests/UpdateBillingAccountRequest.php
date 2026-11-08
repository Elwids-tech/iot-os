<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class UpdateBillingAccountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The organization limit is the `organizations` allowance, set through
     * `allowances/organizations` (ADR-035).
     *
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'contact_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }
}
