<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceAssignment;
use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Integrations\Models\IntegrationApplication;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * What ends at cutover and what stays (spec 031 FR-007, research R7): alerts end as
 * `device_moved`, commands settle with the stop, geofence assignments go, while
 * application grants and dashboards in the source keep the archived device.
 */
final class MoveEndingsTest extends MoveTestCase
{
    public function test_open_alerts_end_as_device_moved_and_late_runtime_transitions_change_nothing(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $open = $this->alert($x, 1);
        $closedByTheStop = $this->alert($x, 2);
        $this->assertSame(2, $this->review($this->a, $this->b, [$x])->json('ends.alerts'));

        $this->confirm($this->a, $this->b, [$x])->assertAccepted();
        // The runtime ends one episode as it stops the device, before the cutover.
        $this->connectivity($this->a, $x, 2, 'stopped', ['stop_reason' => 'device_deactivated'])->assertOk();
        $this->answerStops();

        foreach ([$open, $closedByTheStop] as $alert) {
            $this->assertNotNull($alert->fresh()->cleared_at);
            $this->assertSame(Alert::STOPPED_DEVICE_MOVED, $alert->fresh()->stopped_reason);
        }
        $this->connectivity($this->a, $x, 1, 'cleared')->assertOk();
        $this->assertSame(Alert::STOPPED_DEVICE_MOVED, $open->fresh()->stopped_reason);
        $this->assertNull($open->fresh()->clear_transition_id);
    }

    public function test_unsent_commands_are_cancelled_and_possibly_sent_ones_become_uncertain(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $prepared = $this->command($x, 'prepared');
        $unsent = $this->command($x, 'pending');
        $sent = $this->command($x, 'pending');

        $this->confirm($this->a, $this->b, [$x])->assertAccepted();
        $row = DeviceMoveDevice::firstOrFail();
        $x->refresh();
        $this->runtimeEvent('device.deactivated.v1', ['organization_uuid' => $this->a->uuid, 'device_uuid' => $x->uuid, 'generation' => $x->deployment_generation,
            'operation_uuid' => $row->stop_operation_uuid, 'uncertain_command_uuids' => [$sent->uuid]])->assertOk();

        $this->assertSame(['cancelled', 'cancelled', 'uncertain'], [$prepared->fresh()->status, $unsent->fresh()->status, $sent->fresh()->status]);
        $this->assertSame('archived', $x->fresh()->lifecycle);
    }

    public function test_geofence_assignments_are_removed(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $assignment = $this->assignment($x);
        $this->assertSame(1, $this->review($this->a, $this->b, [$x])->json('ends.geofence_assignments'));

        $this->moved($this->a, $this->b, [$x]);

        $this->assertContains($assignment->fresh()?->status, [null, 'removing', 'failed']);
        $item = DB::table('geofence_activation_items')->where('geofence_assignment_id', $assignment->id)->firstOrFail();
        $this->assertSame(['inactive', $x->uuid], [$item->target, $item->device_uuid]);
    }

    public function test_application_grants_stay_on_the_archived_device(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $application = IntegrationApplication::create(['organization_id' => $this->a->id, 'name' => 'Fleet export', 'abilities' => ['telemetry:read'], 'device_uuids' => [$x->uuid]]);
        $this->assertSame([['name' => 'Fleet export', 'devices' => 1]], $this->review($this->a, $this->b, [$x])->json('ends.application_grants'));

        $this->moved($this->a, $this->b, [$x]);

        $this->assertSame([$x->uuid], $application->fresh()->device_uuids);
        $this->assertSame('archived', Device::where('uuid', $application->fresh()->device_uuids[0])->value('lifecycle'));
    }

    public function test_a_source_dashboard_using_the_archived_device_stays_and_still_saves_unchanged(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $parameter = collect($x->lastAppliedConfiguration->artifact->definition['parameters'])->firstWhere('reports_state', true);
        $panel = ['id' => (string) Str::uuid(), 'schema_version' => 2, 'type' => 'status', 'title' => 'Flow', 'description' => '',
            'config' => ['sources' => [['device_uuid' => $x->uuid, 'parameter_uuid' => $parameter['uuid'], 'label' => 'Flow', 'unit' => $parameter['unit'], 'data_type' => $parameter['data_type'], 'precision' => 2, 'color' => '#2563eb',
                'base' => ['label' => 'Below range', 'color' => '#64748b'], 'thresholds' => [['value' => 0, 'label' => 'Flowing', 'color' => '#2563eb']]]]]];
        $dashboard = $this->postJson($this->in($this->a).'/dashboards', ['name' => 'Fleet', 'widgets' => [$panel], 'layouts' => [], 'defaults' => DashboardDefinition::defaults()])->assertOk()->json('data');
        $keep = ['items' => [['kind' => 'dashboard', 'uuid' => $dashboard['uuid'], 'action' => 'keep']]];
        $this->assertContains('1 dashboard stays in Integrator, showing the moved devices up to the move.', $this->review($this->a, $this->b, [$x], $keep)->json('summary'));

        $this->moved($this->a, $this->b, [$x], $keep);

        $saved = $this->putJson($this->in($this->a).'/dashboards/'.$dashboard['uuid'], ['name' => 'Fleet', 'widgets' => $dashboard['widgets'], 'layouts' => $dashboard['layouts'], 'defaults' => $dashboard['defaults'], 'revision' => $dashboard['revision']])->assertOk()->json('data');
        $this->assertSame($x->uuid, $saved['widgets'][0]['config']['sources'][0]['device_uuid']);
    }

    public function test_offline_alerts_of_a_hosted_adapter_fed_device_are_stored_in_its_organization(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->applied($inB);

        $this->connectivity($this->b, $inB, 1, 'opened')->assertOk();

        $alert = Alert::where('subject_device_id', $inB->id)->firstOrFail();
        $this->assertSame([$this->b->id, Alert::DEVICE_OFFLINE], [$alert->organization_id, $alert->kind]);
        $this->assertSame(0, Alert::where('organization_id', $this->a->id)->where('subject_device_id', $inB->id)->count());
        // A's organization can't own an episode of B's device.
        $this->connectivity($this->a, $inB, 2, 'opened')->assertOk()->assertJsonPath('ignored', 'unknown_reference');
    }

    private function alert(Device $device, int $episode): Alert
    {
        $alert = Alert::create(['organization_id' => $device->organization_id, 'kind' => Alert::DEVICE_OFFLINE, 'severity' => 'warning', 'episode' => $episode,
            'episode_key' => 'device:'.$device->uuid.'#'.$episode, 'subject_device_id' => $device->id, 'activated_at' => now()->subMinutes(5), 'activation_transition_id' => (string) Str::uuid()]);
        $alert->devices()->attach($device->id);

        return $alert;
    }

    private function connectivity($organization, Device $device, int $episode, string $transition, array $extra = [])
    {
        return $this->runtimeEvent('device.connectivity.v1', ['organization_uuid' => $organization->uuid, 'transition' => $transition, 'at' => now()->toIso8601String(),
            'episode' => $episode, 'subject' => ['kind' => 'device', 'device_uuid' => $device->uuid], 'affected_device_uuids' => [$device->uuid], 'cause' => 'missed_check_in', ...$extra]);
    }

    private function command(Device $device, string $status): DeviceCommand
    {
        $uuid = (string) Str::uuid();

        return DeviceCommand::create(['uuid' => $uuid, 'device_id' => $device->id, 'device_configuration_id' => $device->appliedConfiguration->id, 'parameter_uuid' => (string) Str::uuid(),
            'idempotency_key' => (string) Str::uuid(), 'value' => 1, 'status' => $status, 'outstanding_key' => $uuid, 'created_by' => $this->mover->id, 'expires_at' => now()->addMinutes(5)]);
    }

    private function assignment(Device $device): GeofenceAssignment
    {
        $binding = LocationBinding::create(['organization_id' => $this->a->id, 'device_id' => $device->id, 'configuration_uuid' => $device->applied_configuration_uuid, 'generation' => $device->deployment_generation,
            'latitude_parameter_uuid' => (string) Str::uuid(), 'longitude_parameter_uuid' => (string) Str::uuid(), 'updated_by' => $this->mover->id]);
        $fence = Geofence::create(['organization_id' => $this->a->id, 'name' => 'Yard', 'geometry' => ['type' => 'Polygon', 'coordinates' => [[[0, 0], [0, 1], [1, 1], [0, 0]]]], 'revision' => 1, 'created_by' => $this->mover->id, 'updated_by' => $this->mover->id]);
        $workflow = Workflow::create(['uuid' => (string) Str::uuid(), 'organization_id' => $this->a->id, 'name' => 'Yard — Tracker X', 'draft_revision' => 1,
            'workflow' => ['schema_version' => 'automation-workflow.v1', 'nodes' => [], 'edges' => []], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $this->mover->id]);

        return GeofenceAssignment::create(['organization_id' => $this->a->id, 'geofence_id' => $fence->id, 'device_location_binding_id' => $binding->id, 'automation_workflow_id' => $workflow->id,
            'policy' => ['uncertainty_metres' => 10, 'outside_for_seconds' => 60, 'max_gap_seconds' => 120, 'minimum_samples' => 2], 'desired_geofence_revision' => 1, 'applied_geofence_revision' => 1, 'status' => 'active']);
    }
}
