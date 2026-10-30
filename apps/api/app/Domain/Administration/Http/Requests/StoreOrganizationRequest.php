<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class StoreOrganizationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * The organization's billing account (spec 023): an existing one, or a new one created
     * with it. With neither, a new account named after the organization is created.
     *
     * @return array<string, list<string|object>>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'slug' => ['required', 'string', 'max:255', 'alpha_dash', Rule::unique('organizations', 'slug')],
            'billing_account_uuid' => [
                'nullable',
                'uuid',
                Rule::exists('billing_accounts', 'uuid')->whereNull('deleted_at'),
                'prohibits:new_billing_account',
            ],
            'new_billing_account' => ['nullable', 'array:name,contact_email'],
            'new_billing_account.name' => ['required_with:new_billing_account', 'string', 'max:255'],
            'new_billing_account.contact_email' => ['sometimes', 'nullable', 'email', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'billing_account_uuid.prohibits' => 'Choose an existing billing account or a new one, not both.',
            'billing_account_uuid.exists' => 'That billing account no longer exists.',
        ];
    }
}
