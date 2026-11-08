<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Which UTC month of usage to read (spec 028 US4): `YYYY-MM`, or this month when left
 * out. Earlier months stay readable for as long as the account exists.
 */
final class UsageMonthRequest extends FormRequest
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
            /** A UTC month as `YYYY-MM`; this month when left out. */
            'month' => ['nullable', 'date_format:Y-m'],
        ];
    }

    public function month(): CarbonImmutable
    {
        $month = $this->validated('month');

        return $month === null
            ? CarbonImmutable::now('UTC')->startOfMonth()
            : CarbonImmutable::createFromFormat('!Y-m', (string) $month, 'UTC');
    }
}
