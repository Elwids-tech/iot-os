<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Requests;

use App\Domain\Billing\Enums\AllowanceKind;
use Closure;

/**
 * The `allowances` map shared by plan requests: each kind is optional, a whole number
 * within the kind's bounds, or null for unlimited where the kind allows it.
 */
final class PlanAllowanceRules
{
    /**
     * @return array<string, list<string|Closure>>
     */
    public static function rules(): array
    {
        $rules = ['allowances' => [
            'sometimes',
            'array',
            // Only known kinds. Not `array:<kinds>`, which the contract export reads as every
            // kind required, while a kind left out falls back to the default.
            static function (string $attribute, mixed $value, Closure $fail): void {
                if (is_array($value) && array_diff(array_keys($value), AllowanceKind::values()) !== []) {
                    $fail('The :attribute may only set '.implode(', ', AllowanceKind::values()).'.');
                }
            },
        ]];

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
