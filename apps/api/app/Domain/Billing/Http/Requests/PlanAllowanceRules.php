<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Support\Validation\OnlyKeys;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The `allowances` map shared by plan requests: each kind is optional, a whole number
 * within the kind's bounds, or null for unlimited where the kind allows it.
 */
final class PlanAllowanceRules
{
    /**
     * @return array<string, list<string|OnlyKeys>>
     */
    public static function rules(): array
    {
        // Not `array:<kinds>`, which the contract export reads as every kind required, while
        // a kind left out falls back to the default.
        $rules = ['allowances' => ['sometimes', 'array', new OnlyKeys(AllowanceKind::values())]];

        foreach (AllowanceKind::cases() as $kind) {
            $rules['allowances.'.$kind->value] = [
                // Retention is never unlimited: null fails `integer`.
                ...($kind->allowsUnlimited() ? ['nullable'] : []),
                'integer',
                'min:'.$kind->minimum(),
                'max:'.$kind->maximum(),
            ];
        }

        return $rules;
    }

    /**
     * `values` with `allowances` kept when it was sent empty: `validated()` rebuilds an
     * `array` parent from the child keys present, so an empty set, every kind back to
     * the default, would read as not sent.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    public static function keepEmpty(FormRequest $request, array $values): array
    {
        if ($request->has('allowances') && ! array_key_exists('allowances', $values)) {
            $values['allowances'] = [];
        }

        return $values;
    }

    /**
     * @return array<string, string>
     */
    public static function attributes(): array
    {
        return [
            'allowances.alerts' => 'alert allowance',
            'allowances.sms' => 'SMS allowance',
            'allowances.devices' => 'device limit',
            'allowances.data_points' => 'data point allowance',
            'allowances.retention_days' => 'retention',
            'allowances.organizations' => 'organization limit',
        ];
    }
}
