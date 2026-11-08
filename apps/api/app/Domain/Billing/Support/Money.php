<?php

declare(strict_types=1);

namespace App\Domain\Billing\Support;

/**
 * Integer money in the deployment currency's minor units (research R11): amounts never
 * leave integers until shown, and every division rounds half away from zero, which is
 * half up for the non-negative amounts invoices mostly hold.
 */
final class Money
{
    /** `amount × numerator / denominator`, rounded half up. */
    public static function share(int $amount, int $numerator, int $denominator): int
    {
        return self::divide($amount * $numerator, $denominator);
    }

    /** Tax on an amount at a rate in basis points, rounded half up. */
    public static function tax(int $amount, int $basisPoints): int
    {
        return self::divide($amount * $basisPoints, 10_000);
    }

    /** "1,250.00": two decimal places, as D6 shows every amount. */
    public static function format(int $amount): string
    {
        return ($amount < 0 ? '-' : '').number_format(abs($amount) / 100, 2, '.', ',');
    }

    /** Money as the API sends it. */
    public static function json(int $amount): array
    {
        return ['amount' => $amount, 'currency' => (string) config('billing.currency'), 'formatted' => self::format($amount)];
    }

    private static function divide(int $numerator, int $denominator): int
    {
        $quotient = intdiv(abs($numerator) * 2 + $denominator, $denominator * 2);

        return $numerator < 0 ? -$quotient : $quotient;
    }
}
