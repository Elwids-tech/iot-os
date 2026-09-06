<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\DeviceOutbox;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class DeviceAudit
{
    public static function record(string $action, ?int $organization, ?int $actor, ?string $resource, array $details = []): void
    {
        DB::table('device_audit_events')->insert([
            'uuid' => (string) Str::uuid(), 'organization_id' => $organization, 'actor_id' => $actor,
            'resource_uuid' => $resource, 'action' => $action, 'details' => json_encode($details, JSON_THROW_ON_ERROR), 'created_at' => now(),
        ]);
    }

    public static function enqueue(string $type, array $payload): DeviceOutbox
    {
        return DeviceOutbox::create(['type' => $type, 'payload' => $payload, 'created_at' => now()]);
    }
}
