<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * One account's price from next month (spec 029 FR-028), in minor units, and why; null
 * goes back to the plan's price.
 */
final class OverridePriceRequest extends FormRequest
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
            'value' => ['present', 'nullable', 'integer', 'between:0,1000000000000'],
            'note' => ['required_with:value', 'nullable', 'string', 'max:1000'],
        ];
    }
}
