<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Enums\AllowanceKind;
use Illuminate\Foundation\Http\FormRequest;

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
        $kind = AllowanceKind::from((string) $this->route('kind'));

        return [
            /** Applies a change that shortens organizations' telemetry retention, after the 409 named them. */
            'confirm_retention' => ['sometimes', 'boolean'],
            'value' => [
                'present',
                ...($kind->allowsUnlimited() ? ['nullable'] : []),
                'integer',
                'min:'.$kind->minimum(),
                'max:'.$kind->maximum(),
            ],
            'note' => ['required', 'string', 'max:1000'],
        ];
    }
}
