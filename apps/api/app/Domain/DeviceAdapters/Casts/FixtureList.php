<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * An adapter's sample fixtures, always a list in the order they were given.
 *
 * Laravel rebuilds validated wildcard arrays rule by rule, so samples with a topic came
 * back before one without (keys 1, 2, 0) and were stored as a JSON object, which the
 * adapter runtime refuses to test. Reading and writing through this cast puts them back
 * in their original order, including rows already stored as objects.
 */
final class FixtureList implements CastsAttributes
{
    public static function normalize(mixed $fixtures): array
    {
        if (! is_array($fixtures)) {
            return [];
        }
        if (array_is_list($fixtures)) {
            return $fixtures;
        }
        ksort($fixtures, SORT_NUMERIC);

        return array_values($fixtures);
    }

    public function get(Model $model, string $key, mixed $value, array $attributes): ?array
    {
        return $value === null ? null : self::normalize(json_decode((string) $value, true));
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        return $value === null ? null : json_encode(self::normalize($value), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    }
}
