<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Models\BillingPlan;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Starts or changes a trial (spec 029 US8): its plan (the account's plan when omitted)
 * and the instant it ends, or `ends_at: null` for no end date. Invoices charge each day
 * by the assignment in force at 00:00 UTC, so a trial ending at 00:00 UTC on the 9th
 * runs until the 8th and is charged from the 9th.
 */
final class TrialRequest extends FormRequest
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
            'plan_uuid' => ['sometimes', 'nullable', 'uuid', Rule::exists('billing_plans', 'uuid')],
            /** When the trial ends, in the future; null for no end date. */
            'ends_at' => ['present', 'nullable', 'date', 'after:now'],
            /** Applies a plan that shortens organizations' telemetry retention, after the 409 named them. */
            'confirm_retention' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['ends_at.after' => 'Choose an end date in the future.'];
    }

    public function plan(): ?BillingPlan
    {
        $uuid = $this->validated('plan_uuid');

        return $uuid === null ? null : BillingPlan::query()->where('uuid', $uuid)->firstOrFail();
    }

    public function endsAt(): ?CarbonImmutable
    {
        $endsAt = $this->validated('ends_at');

        return $endsAt === null ? null : CarbonImmutable::parse((string) $endsAt)->utc();
    }
}
