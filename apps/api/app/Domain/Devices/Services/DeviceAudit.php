<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\DeviceOutbox;

final class DeviceAudit
{
    /** Records an audit event by the subject's UUID; new code calls {@see ActivityLog::record()} directly. */
    public static function record(string $action, ?int $organization, ?int $actor, ?string $resource, array $details = []): void
    {
        ActivityLog::record($action, $organization, $actor, $resource, $details);
    }

    public static function enqueue(string $type, array $payload): DeviceOutbox
    {
        return DeviceOutbox::create(['type' => $type, 'payload' => $payload, 'created_at' => now()]);
    }
}
