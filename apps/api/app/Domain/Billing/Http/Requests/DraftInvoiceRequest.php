<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Draft an account's invoice for a month now, before its usage is final (spec 029
 * FR-033): the month and why. The draft is marked possibly incomplete.
 */
final class DraftInvoiceRequest extends FormRequest
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
            /** A UTC month as `YYYY-MM`, this month or earlier. */
            'month' => ['required', 'date_format:Y-m'],
            'note' => ['required', 'string', 'max:1000'],
        ];
    }
}
