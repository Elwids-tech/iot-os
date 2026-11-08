<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Puts a billing account on a plan, or takes it off with `plan_uuid: null` (spec 028
 * US2). Archived plans cannot be newly assigned.
 */
final class SetBillingAccountPlanRequest extends FormRequest
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
            'plan_uuid' => ['present', 'nullable', 'uuid', Rule::exists('billing_plans', 'uuid')],
        ];
    }
}
