<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Services;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceAssignment;
use App\Domain\Geospatial\Models\LocationBinding;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class GeofenceEventJournal
{
    public static function record(Deployment $deployment, array $transition, string $kind): void
    {
        $assignment = GeofenceAssignment::where('automation_workflow_id', $deployment->automation_workflow_id)->first();
        if (! $assignment || DB::table('geofence_events')->where('transition_id', $transition['id'])->exists()) {
            return;
        }
        $binding = LocationBinding::findOrFail($assignment->device_location_binding_id);
        $fence = Geofence::findOrFail($assignment->geofence_id);
        $uuid = (string) Str::uuid();
        $snapshot = ['uuid' => $uuid, 'geofence_uuid' => $fence->uuid, 'geofence_name' => $fence->name,
            'assignment_uuid' => $assignment->uuid, 'device_uuid' => $binding->device->uuid, 'type' => $kind,
            'source_event_uuid' => $transition['event_id'] ?: null, 'occurred_at' => $transition['occurred_at']];
        DB::table('geofence_events')->insert(['uuid' => $uuid, 'organization_id' => $assignment->organization_id, 'geofence_id' => $fence->id,
            'geofence_assignment_id' => $assignment->id, 'transition_id' => $transition['id'], 'type' => $kind,
            'source_event_uuid' => $transition['event_id'] ?: null, 'snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR),
            'occurred_at' => $transition['occurred_at'], 'recorded_at' => now()]);

        DB::table('integration_streams')->insertOrIgnore(['organization_id' => $assignment->organization_id, 'sequence' => 0]);
        $stream = DB::table('integration_streams')->where('organization_id', $assignment->organization_id)->lockForUpdate()->first();
        $sequence = $stream->sequence + 1;
        DB::table('integration_events')->insert(['uuid' => (string) Str::uuid(), 'organization_id' => $assignment->organization_id,
            'sequence' => $sequence, 'device_uuid' => $binding->device->uuid, 'resource_uuid' => $uuid,
            'type' => 'geofence.'.$kind.'.v1', 'snapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR),
            'occurred_at' => $transition['occurred_at'], 'recorded_at' => now()]);
        DB::table('integration_streams')->where('organization_id', $assignment->organization_id)->update(['sequence' => $sequence]);
    }
}
