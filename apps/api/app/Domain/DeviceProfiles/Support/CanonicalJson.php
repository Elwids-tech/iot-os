<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Support;

use JsonException;

final class CanonicalJson
{
    /**
     * @param  array<string, mixed>  $value
     */
    public function encode(array $value): string
    {
        try {
            return json_encode(
                $this->normalize($value),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION,
            );
        } catch (JsonException $exception) {
            throw new \InvalidArgumentException('The profile cannot be encoded as canonical JSON.', previous: $exception);
        }
    }

    /**
     * Recursively sort object keys while preserving list order.
     */
    public function normalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->normalize($item), $value);
        }

        ksort($value, SORT_STRING);

        foreach ($value as $key => $item) {
            $value[$key] = $this->normalize($item);
        }

        return $value;
    }
}
