<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The operator's billing details and number prefixes (spec 029 FR-029), with the revision
 * they were read at: a stale one answers 409.
 */
final class UpdateBillingSettingsRequest extends FormRequest
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
            'revision' => ['required', 'integer', 'min:0'],
            'legal_name' => ['present', 'nullable', 'string', 'max:255'],
            'address' => ['present', 'nullable', 'string', 'max:2000'],
            'tax_registration_number' => ['present', 'nullable', 'string', 'max:64'],
            'invoice_footer' => ['present', 'nullable', 'string', 'max:2000'],
            /** Letters, digits and `-`, `_` or `/`, up to 16; numbers continue across a change. */
            'invoice_prefix' => ['required', 'string', 'max:16', 'regex:/^[A-Za-z0-9_\/-]+$/'],
            'credit_note_prefix' => ['required', 'string', 'max:16', 'regex:/^[A-Za-z0-9_\/-]+$/'],
        ];
    }
}
