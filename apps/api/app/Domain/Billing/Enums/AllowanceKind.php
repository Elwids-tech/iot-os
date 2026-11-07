<?php

declare(strict_types=1);

namespace App\Domain\Billing\Enums;

/**
 * What a plan can limit (ADR-035). Allowances are rows keyed by these values, so a
 * new limit is a new case, not a new column. A `null` value is unlimited, except for
 * retention, which is never unlimited: a missing retention row means the platform's
 * retention setting applies.
 */
enum AllowanceKind: string
{
    case Alerts = 'alerts';
    case Sms = 'sms';
    case Devices = 'devices';
    case DataPoints = 'data_points';
    case RetentionDays = 'retention_days';
    case Organizations = 'organizations';

    public function allowsUnlimited(): bool
    {
        return $this !== self::RetentionDays;
    }

    /** Counted per calendar month in UTC; the others are levels or settings. */
    public function isMonthly(): bool
    {
        return in_array($this, [self::Alerts, self::Sms, self::DataPoints], true);
    }

    public function minimum(): int
    {
        return $this === self::RetentionDays ? 1 : 0;
    }

    public function maximum(): int
    {
        return match ($this) {
            self::RetentionDays => 36500,
            self::Organizations => 100000,
            default => 1_000_000_000_000,
        };
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $kind): string => $kind->value, self::cases());
    }
}
