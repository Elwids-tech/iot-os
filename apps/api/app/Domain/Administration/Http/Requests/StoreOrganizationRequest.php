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
            // A plan for the new account (spec 028 FR-010); an existing account keeps its own.
            'plan_uuid' => [
                'nullable',
                'uuid',
                Rule::exists('billing_plans', 'uuid')->whereNull('archived_at'),
                'prohibits:billing_account_uuid',
            ],
            // Or a trial on a plan for the new account (spec 029 US8): an end instant, or null for none.
            'trial' => ['nullable', 'array:plan_uuid,ends_at', 'prohibits:billing_account_uuid,plan_uuid'],
            'trial.plan_uuid' => ['required_with:trial', 'uuid', Rule::exists('billing_plans', 'uuid')->whereNull('archived_at')],
            'trial.ends_at' => ['nullable', 'date', 'after:now'],
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
            'plan_uuid.exists' => 'Choose a plan that exists and is not archived.',
            'plan_uuid.prohibits' => 'An existing billing account keeps its plan; choose a plan only for a new account.',
            'trial.prohibits' => 'Start a trial only on a new billing account, instead of choosing its plan.',
            'trial.plan_uuid.exists' => 'Choose a plan that exists and is not archived.',
            'trial.ends_at.after' => 'Choose an end date in the future.',
        ];
    }
}
