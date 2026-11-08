<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Models\TaxRate;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A named tax rate (spec 029 FR-029): a unique name and basis points from 0 to 10,000
 * (0% to 100%). Editing sends only what changes.
 */
final class TaxRateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        $rate = $this->route('taxRate');
        $editing = $rate instanceof TaxRate;

        return [
            'name' => [$editing ? 'sometimes' : 'required', 'string', 'max:100', Rule::unique('billing_tax_rates', 'name')->ignore($editing ? $rate->getKey() : null)],
            /** Hundredths of a percent: 1500 is 15%. */
            'basis_points' => [$editing ? 'sometimes' : 'required', 'integer', 'between:0,10000'],
        ];
    }
}
