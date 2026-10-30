<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

/**
 * One field an administrator changed on a billing account, with its old and new value
 * as text (null when empty).
 */
final readonly class BillingAccountChange
{
    public function __construct(
        public string $field,
        public ?string $from,
        public ?string $to,
    ) {}

    public static function text(mixed $value): ?string
    {
        return $value === null ? null : (string) $value;
    }
}
