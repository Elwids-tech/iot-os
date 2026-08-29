<?php

declare(strict_types=1);

namespace App\Domain\Shared\Data;

use Illuminate\Support\Str;
use InvalidArgumentException;

final class AuthoringPayload
{
    /** @param array<string, mixed> $value */
    public static function assertAllowedKeys(array $value, array $allowed, string $path): void
    {
        $unknown = array_values(array_diff(array_keys($value), $allowed));

        if ($unknown !== []) {
            throw new InvalidArgumentException(sprintf(
                '%s contains unsupported fields: %s.',
                $path,
                implode(', ', $unknown),
            ));
        }
    }

    /** @return array<string, mixed> */
    public static function object(mixed $value, string $path): array
    {
        if (! is_array($value) || array_is_list($value) && $value !== []) {
            throw new InvalidArgumentException("{$path} must be a JSON object.");
        }

        return $value;
    }

    /** @return list<mixed> */
    public static function list(mixed $value, string $path): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            throw new InvalidArgumentException("{$path} must be a JSON array.");
        }

        return $value;
    }

    public static function string(mixed $value, string $path): string
    {
        if (! is_string($value) || trim($value) === '') {
            throw new InvalidArgumentException("{$path} must be a non-empty string.");
        }

        return trim($value);
    }

    public static function nullableString(mixed $value, string $path): ?string
    {
        if ($value === null) {
            return null;
        }

        if (! is_string($value)) {
            throw new InvalidArgumentException("{$path} must be a string or null.");
        }

        return $value;
    }

    public static function uuid(mixed $value, string $path): string
    {
        $uuid = self::string($value, $path);

        if (! Str::isUuid($uuid)) {
            throw new InvalidArgumentException("{$path} must be a UUID.");
        }

        return strtolower($uuid);
    }

    public static function key(mixed $value, string $path): string
    {
        $key = self::string($value, $path);

        if (preg_match('/^[a-z][a-z0-9_]{0,99}$/', $key) !== 1) {
            throw new InvalidArgumentException("{$path} must be a lower_snake_case key.");
        }

        return $key;
    }

    public static function positiveInteger(mixed $value, string $path): int
    {
        if (! is_int($value) || $value < 1) {
            throw new InvalidArgumentException("{$path} must be a positive integer.");
        }

        return $value;
    }

    public static function boolean(mixed $value, string $path): bool
    {
        if (! is_bool($value)) {
            throw new InvalidArgumentException("{$path} must be a boolean.");
        }

        return $value;
    }

    private function __construct() {}
}
