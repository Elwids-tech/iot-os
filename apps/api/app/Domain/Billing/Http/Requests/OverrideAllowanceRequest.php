<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Enums\AllowanceKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * An allowance for one billing account, replacing its plan's (spec 028 FR-008): a whole
 * number, or null for unlimited where the kind allows it, and why.
 */
final class OverrideAllowanceRequest extends FormRequest
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
            /** Applies a change that shortens organizations' telemetry retention, after the 409 named them. */
            'confirm_retention' => ['sometimes', 'boolean'],
            /** A whole number within the kind's bounds (retention 1 to 36,500 days, organizations up to 100,000), or null for unlimited, which retention cannot be. */
            'value' => ['present', 'nullable', 'integer', 'min:0', 'max:'.AllowanceKind::Alerts->maximum()],
            'note' => ['required', 'string', 'max:1000'],
        ];
    }

    /**
     * The kind's own bounds. They depend on the route, so they stay out of `rules()`,
     * which the contract export reads without one.
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                if ($validator->errors()->has('value')) {
                    return;
                }
                $kind = AllowanceKind::from((string) $this->route('kind'));
                $value = $this->input('value');
                if ($value === null) {
                    if (! $kind->allowsUnlimited()) {
                        $validator->errors()->add('value', 'Retention cannot be unlimited. Enter a number of days.');
                    }

                    return;
                }
                if ((int) $value < $kind->minimum() || (int) $value > $kind->maximum()) {
                    $validator->errors()->add('value', sprintf('The value must be between %s and %s.', number_format($kind->minimum()), number_format($kind->maximum())));
                }
            },
        ];
    }
}
