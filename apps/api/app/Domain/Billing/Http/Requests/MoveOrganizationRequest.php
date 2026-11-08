<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class MoveOrganizationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string|object>>
     */
    public function rules(): array
    {
        return [
            /** Applies a change that shortens organizations' telemetry retention, after the 409 named them. */
            'confirm_retention' => ['sometimes', 'boolean'],
            'billing_account_uuid' => ['required', 'uuid', Rule::exists('billing_accounts', 'uuid')->whereNull('deleted_at')],
        ];
    }
}
