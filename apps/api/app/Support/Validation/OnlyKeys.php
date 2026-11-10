<?php

declare(strict_types=1);

namespace App\Support\Validation;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Refuses an array with keys other than these. Laravel's `array:<keys>` does the same,
 * but the contract export reads it as every key required, so optional keys use this
 * with a plain `array` rule (docs/dev/gotchas.md).
 */
final readonly class OnlyKeys implements ValidationRule
{
    /**
     * @param  list<string>  $keys
     */
    public function __construct(private array $keys) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_array($value) && array_diff(array_keys($value), $this->keys) !== []) {
            $fail('The :attribute may only set '.implode(', ', $this->keys).'.');
        }
    }
}
