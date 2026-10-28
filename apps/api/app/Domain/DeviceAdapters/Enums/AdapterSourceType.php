<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Enums;

/** How an adapter receives vendor data (spec 020, FR-001). */
enum AdapterSourceType: string
{
    case Platform = 'platform';
    case Vendor = 'vendor';
    case Webhook = 'webhook';
    case Poll = 'poll';

    /** Sources that subscribe to MQTT topic filters the person chooses. */
    public function hasTopics(): bool
    {
        return in_array($this, [self::Platform, self::Vendor], true);
    }

    public function label(): string
    {
        return match ($this) {
            self::Platform => 'Tenant MQTT broker',
            self::Vendor => 'Vendor MQTT broker',
            self::Webhook => 'HTTP webhook',
            self::Poll => 'HTTP polling',
        };
    }
}
