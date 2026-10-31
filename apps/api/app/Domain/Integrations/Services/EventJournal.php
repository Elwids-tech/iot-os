<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Automation\Models\Alert;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class EventJournal
{
    // Caller must hold the alert row lock in the transaction that changes it.
    public static function alert(Alert $alert, string $change): void
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException('Integration events require the source transaction.');
        }
        // `alert.*.v1` carries workflow alerts; device connectivity alerts have their own events (spec 018).
        if (! $alert->isWorkflow()) {
            return;
        }
        $timestamp = match ($change) {
            'activated' => $alert->activated_at,
            'cleared' => $alert->cleared_at,
            'acknowledged' => $alert->acknowledged_at,
            default => throw new \LogicException('Unsupported alert event.'),
        };
        // The per-tenant lock serializes sequence allocation through COMMIT.
        // A database sequence alone could expose N+1 before N commits.
        DB::table('integration_streams')->insertOrIgnore(['organization_id' => $alert->organization_id, 'sequence' => 0]);
        $stream = DB::table('integration_streams')->where('organization_id', $alert->organization_id)->lockForUpdate()->first();
        $type = 'alert.'.$change.'.v1';
        if (DB::table('integration_events')->where('resource_uuid', $alert->uuid)->where('type', $type)->exists()) {
            return;
        }
        $sequence = $stream->sequence + 1;
        $snapshot = AlertSnapshot::of($alert);
        DB::table('integration_events')->insert(['uuid' => (string) Str::uuid(), 'organization_id' => $alert->organization_id, 'sequence' => $sequence, 'device_uuid' => $snapshot['device_uuid'], 'resource_uuid' => $alert->uuid, 'type' => $type, 'snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR), 'occurred_at' => $timestamp, 'recorded_at' => now()]);
        DB::table('integration_streams')->where('organization_id', $alert->organization_id)->update(['sequence' => $sequence]);
    }
}
