<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * A new plan (spec 028 FR-001). `allowances` maps a kind to a whole number, or to null
 * for unlimited; a kind left out falls back to the deployment's default.
 */
final class StorePlanRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            ...PlanAllowanceRules::rules(),
        ];
    }

    public function after(): array
    {
        return [
            fn (Validator $validator) => PlanNameRule::check($validator, (string) $this->input('name')),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function attributes(): array
    {
        return PlanAllowanceRules::attributes();
    }
}
