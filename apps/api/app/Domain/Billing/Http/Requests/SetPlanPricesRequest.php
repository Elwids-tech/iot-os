<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A plan's prices from next month (spec 029 FR-027, FR-028), in the currency's minor
 * units: the monthly base price, the price per alert over the allowance, and the price
 * per block of data points over it, with the block size.
 */
final class SetPlanPricesRequest extends FormRequest
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
            'base_price' => ['required', 'integer', 'between:0,1000000000000'],
            'alert_overage_price' => ['required', 'integer', 'between:0,1000000000000'],
            'data_point_overage_price' => ['required', 'integer', 'between:0,1000000000000'],
            'data_point_block_size' => ['required', 'integer', 'between:1,1000000000'],
        ];
    }
}
