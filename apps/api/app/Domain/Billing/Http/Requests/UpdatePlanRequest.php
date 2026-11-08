<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Models\BillingPlan;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Changes to a plan (spec 028 FR-003). `allowances`, when sent, is the complete set.
 * Changing the allowances of a plan in use needs `confirm_affected`: the number of
 * billing accounts on it, which a 409 reports.
 */
final class UpdatePlanRequest extends FormRequest
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
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            ...PlanAllowanceRules::rules(),
            'confirm_affected' => ['sometimes', 'nullable', 'integer', 'min:0'],
            /** Applies a change that shortens organizations' telemetry retention, after the 409 named them. */
            'confirm_retention' => ['sometimes', 'boolean'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($this->has('name')) {
                    /** @var BillingPlan $plan */
                    $plan = $this->route('billingPlan');
                    PlanNameRule::check($validator, (string) $this->input('name'), $plan);
                }
            },
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
