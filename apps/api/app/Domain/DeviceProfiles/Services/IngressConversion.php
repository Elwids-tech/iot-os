<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use Illuminate\Validation\ValidationException;

final class IngressConversion
{
    public function eligible(array $parameter): bool
    {
        return in_array($parameter['kind'] ?? null, ['measurement', 'counter'], true)
            && in_array($parameter['data_type'] ?? null, ['number', 'integer'], true)
            && ($parameter['reports_state'] ?? true)
            && ! ($parameter['accepts_command'] ?? false);
    }

    public function validate(array $parameter, mixed $conversion, string $field = 'ingress_conversion'): ?array
    {
        if ($conversion === null) {
            return null;
        }
        $fail = static fn (string $message) => throw ValidationException::withMessages([$field => $message]);
        if (! $this->eligible($parameter)) {
            $fail('Incoming conversion requires a read-only numeric measurement or counter.');
        }
        if (! is_array($conversion) || array_diff(array_keys($conversion), ['source_unit', 'multiplier', 'offset'])) {
            $fail('Use source_unit, multiplier, and offset for an incoming conversion.');
        }
        foreach (['multiplier', 'offset'] as $key) {
            $number = $conversion[$key] ?? null;
            if ((! is_int($number) && ! is_float($number)) || ! is_finite((float) $number)) {
                $fail('Multiplier and offset must be finite numbers.');
            }
        }
        if ($conversion['multiplier'] == 0) {
            $fail('The multiplier must not be zero.');
        }
        if (($parameter['counter_config']['monotonic'] ?? $parameter['counter']['monotonic'] ?? false) && $conversion['multiplier'] < 0) {
            $fail('A monotonic counter requires a positive multiplier.');
        }
        $unit = $conversion['source_unit'] ?? null;
        if ($unit !== null && (! is_string($unit) || mb_strlen($unit) > 255)) {
            $fail('The incoming unit must be text of at most 255 characters.');
        }

        return ['source_unit' => $unit, 'multiplier' => $conversion['multiplier'], 'offset' => $conversion['offset']];
    }

    public function apply(array $parameter, mixed $value): int|float
    {
        $conversion = $this->validate($parameter, $parameter['ingress_conversion'] ?? null);
        if ((! is_int($value) && ! is_float($value)) || ! is_finite((float) $value)) {
            throw ValidationException::withMessages(['value' => 'The incoming sample must be a finite number.']);
        }
        $result = $conversion === null ? $value : $value * $conversion['multiplier'] + $conversion['offset'];
        if (! is_finite((float) $result) || (($parameter['data_type'] ?? null) === 'integer' && (floor($result) != $result || abs($result) > 9007199254740991))) {
            throw ValidationException::withMessages(['value' => 'The converted value must fit the stored numeric type without rounding.']);
        }

        return ($parameter['data_type'] ?? null) === 'integer' ? (int) $result : $result;
    }

    public function resolve(array $parameter, array $mapping, string $field): array
    {
        $mode = $mapping['conversion_mode'] ?? 'profile';
        if (! in_array($mode, ['profile', 'custom', 'none'], true)) {
            throw ValidationException::withMessages([$field.'.conversion_mode' => 'Choose profile, custom, or none.']);
        }
        if ($mode !== 'custom' && ($mapping['ingress_conversion'] ?? null) !== null) {
            throw ValidationException::withMessages([$field => 'Only a custom conversion can supply settings.']);
        }
        if ($mode === 'custom' && ($mapping['ingress_conversion'] ?? null) === null) {
            throw ValidationException::withMessages([$field => 'Custom conversion settings are required.']);
        }
        $conversion = match ($mode) {
            'profile' => $parameter['ingress_conversion'] ?? null,
            'custom' => $mapping['ingress_conversion'],
            'none' => null,
        };

        return ['conversion_mode' => $mode, 'ingress_conversion' => $this->validate($parameter, $conversion, $field.'.ingress_conversion')];
    }
}
