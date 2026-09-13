<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\DeviceProfiles\Services\RestrictedExpression;
use Illuminate\Validation\ValidationException;

final class ParameterValue
{
    public function validate(array $parameter, mixed $value): void
    {
        $valid = match ($parameter['data_type']) {
            'boolean' => is_bool($value), 'integer' => is_int($value) && abs($value) <= 9007199254740991,
            'number' => (is_int($value) || is_float($value)) && is_finite((float) $value),
            'enum', 'string' => is_string($value) && mb_strlen($value) <= 65536,
            'timestamp' => is_string($value) && strtotime($value) !== false,
            'bytes' => is_string($value) && base64_decode($value, true) !== false,
            default => false,
        };
        if (($parameter['format'] ?? null) === 'hex_color') {
            $valid = $valid && is_string($value) && preg_match('/^#[0-9a-fA-F]{6}$/', $value);
        }
        if ($valid && ($parameter['validation'] ?? null)) {
            try {
                $valid = (bool) app(RestrictedExpression::class)->evaluate($parameter['validation']['rule'], ['value' => $value]);
            } catch (\InvalidArgumentException) {
                $valid = false;
            }
        }
        if (! $valid) {
            throw ValidationException::withMessages(['value' => 'The requested value does not satisfy the applied profile’s type, format or validation rule.']);
        }
    }
}
