<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A billing account's details for its invoices (spec 029 FR-029): address, optional tax
 * number, and a tax rate by uuid or null for none.
 */
final class UpdateBillingDetailsRequest extends FormRequest
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
            'billing_address' => ['present', 'nullable', 'string', 'max:2000'],
            'tax_number' => ['present', 'nullable', 'string', 'max:64'],
            'tax_rate_uuid' => ['present', 'nullable', 'uuid', 'exists:billing_tax_rates,uuid'],
        ];
    }
}
