<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A charge or credit on a draft (spec 029 FR-034): what the customer reads, the amount in
 * minor units (negative for a credit, never 0), and an administrator's note.
 */
final class AddAdjustmentRequest extends FormRequest
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
            'description' => ['required', 'string', 'max:255'],
            'amount' => ['required', 'integer', 'between:-1000000000000,1000000000000', 'not_in:0'],
            'note' => ['required', 'string', 'max:1000'],
        ];
    }
}
