<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Authorization\Models\Role;
use App\Domain\Billing\Services\DeviceLimit;
use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\DeviceProfileCopy;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceLink;
use App\Domain\Devices\Models\DeviceOutbox;
use App\Domain\Devices\Permissions\DevicePermission;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * The cutover (spec 031 US1, FR-007): an active adapter-fed device is stopped, then
 * archived in A as moved and recreated in B on a copy of its profile, on the same adapter
 * source with an installation of its own, and the adapter is redeployed once.
 */
final class MoveCutoverTest extends MoveTestCase
{
    public function test_an_active_adapter_fed_device_stops_then_cuts_over_onto_a_copied_profile_and_a_new_installation(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        $place = $x->limit_place_at;
        $this->deploys = [];

        $move = $this->confirm($this->a, $this->b, [$x], ['devices' => [['uuid' => $x->uuid, 'name' => 'Shop tracker']]])->assertAccepted()->json('data');
        $this->assertSame('stopping', $move['status']);
        $this->assertSame(1, $move['waiting_for']['devices_stopping']);
        $this->assertSame([['predecessor_uuid' => $x->uuid, 'successor_uuid' => null, 'name' => 'Shop tracker', 'state' => 'stopping', 'successor_state' => null, 'successor_reason' => null]], $move['devices']);
        // The stop is an ordinary deactivation that keeps the device-limit place.
        $this->assertSame('pending', $x->fresh()->deployment_status);
        $this->assertEquals($place, $x->fresh()->limit_place_at);
        $this->assertSame([], $this->deploys);

        $this->answerStops();
        $move = $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->assertOk()->json('data');
        $this->assertSame('completed', $move['status']);
        $this->assertNotNull($move['cutover_at']);

        $predecessor = $x->fresh();
        $successor = $this->successor($x);
        $this->assertSame(['archived', null, null], [$predecessor->lifecycle, $predecessor->reserved_source_uuid, $predecessor->limit_place_at]);
        $this->assertSame('moved', DeviceInstallation::where('device_id', $x->id)->value('ended_reason'));
        $this->assertSame(['moved_to', 'Harbour Shop'], [$this->getJson($this->in($this->a).'/devices/'.$x->uuid)->json('data.link.direction'), $this->getJson($this->in($this->a).'/devices/'.$x->uuid)->json('data.link.organization_name')]);

        // The successor: B's device on the same source, with a copied profile and its own installation.
        $this->assertSame([$this->b->id, 'Shop tracker', 'tracker-x'], [$successor->organization_id, $successor->name, $successor->code]);
        $this->assertSame([$x->device_discovery_candidate_id, $x->reserved_source_uuid], [$successor->device_discovery_candidate_id, $successor->reserved_source_uuid]);
        $this->assertEquals($place, $successor->limit_place_at);
        $copy = DeviceProfileCopy::where('target_organization_id', $this->b->id)->firstOrFail();
        $target = DeviceProfileArtifact::findOrFail($copy->target_artifact_id);
        $this->assertSame($this->b->id, DeviceProfile::whereKey($target->device_profile_id)->value('organization_id'));
        $this->assertSame($target->uuid, $successor->draft['artifact_uuid']);
        $sourceMappings = $x->lastAppliedConfiguration->definition['mappings'];
        $this->assertSame(array_map(fn (array $m) => $copy->parameter_map[$m['parameter_uuid']], $sourceMappings), array_column($successor->draft['mappings'], 'parameter_uuid'));
        $this->assertEmpty(array_intersect(array_column($sourceMappings, 'parameter_uuid'), array_column($successor->draft['mappings'], 'parameter_uuid')));
        $installation = DeviceInstallation::where('device_id', $successor->id)->whereNull('ended_at')->firstOrFail();
        $this->assertSame($this->a->id, $installation->organization_id);
        $this->assertSame(DeviceInstallation::where('device_id', $x->id)->value('device_adapter_candidate_id'), $installation->device_adapter_candidate_id);

        // Its activation is queued against the pipe owner's source, under B.
        $this->assertSame('pending', $successor->deployment_status);
        $activation = DeviceOutbox::where('type', 'device.activate.v1')->where('payload->device_uuid', $successor->uuid)->firstOrFail()->payload;
        $this->assertSame($this->b->uuid, $activation['organization_uuid']);
        $this->assertSame($installation->uuid, $activation['definition']['adapter']['installation_uuid']);
        $this->assertSame('adapters-'.$this->a->uuid, $activation['definition']['source']['group_id']);
        $this->assertNotEmpty($activation['birth_metrics']);

        // One redeploy of the adapter, binding the new installation and dropping the ended one.
        $this->assertCount(1, $this->deploys);
        $bindings = collect($this->deploys[0]['bindings'])->keyBy('installation_uuid');
        $this->assertSame($successor->uuid, $bindings[$installation->uuid]['virtual_device_uuid']);
        $this->assertNotContains($x->uuid, $bindings->pluck('virtual_device_uuid')->all());
        $this->assertContains($y->uuid, $bindings->pluck('virtual_device_uuid')->all());
        // Y keeps reporting.
        $this->assertSame(['active', 'applied'], [$y->fresh()->lifecycle, $y->fresh()->deployment_status]);

        // The activity log has the move on both sides.
        $events = fn (int $organization) => DB::table('activity_log')->where('organization_id', $organization)->whereIn('event', ['device_move.started', 'device_move.completed', 'device.moved_out', 'device.moved_in'])->orderBy('id')->pluck('event')->all();
        $this->assertSame(['device_move.started', 'device.moved_out', 'device_move.completed'], $events($this->a->id));
        $this->assertSame(['device_move.started', 'device.moved_in', 'device_move.completed'], $events($this->b->id));

        // B sees where it came from and what it reports through, and nothing else of A.
        $this->applied($successor);
        $read = $this->as($this->bOnly, fn () => $this->getJson($this->in($this->b).'/devices/'.$successor->uuid)->assertOk()->json('data'));
        $this->assertSame('moved_from', $read['link']['direction']);
        $this->assertSame('Integrator', $read['link']['organization_name']);
        $this->assertSame(['kind' => 'adapter', 'name' => 'Vendor meters', 'owner_organization_name' => 'Integrator', 'online' => true, 'hosted' => true], $read['pipe']);
        $this->assertNull($read['candidate']['gateway']);
        $this->assertNull($read['candidate']['adapter']);
        $this->assertNotEmpty($read['candidate']['metrics']);
        $this->assertNull($read['installations'][0]['adapter_revision_uuid']);
        $this->assertSame('active', $successor->fresh()->lifecycle);
    }

    public function test_an_inactive_device_moves_in_one_request(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X', active: false);
        $this->deploys = [];

        $move = $this->confirm($this->a, $this->b, [$x])->assertAccepted()->json('data');

        $this->assertSame('completed', $move['status']);
        $successor = $this->successor($x);
        $this->assertSame(['registered', null, null], [$successor->lifecycle, $successor->desired_configuration_uuid, $successor->limit_place_at]);
        $this->assertSame('inactive', $move['devices'][0]['successor_state']);
        $this->assertSame([], $move['needs_attention']);
        $this->assertNotNull($successor->draft['artifact_uuid']);
        $this->assertCount(1, $this->deploys);
    }

    public function test_without_device_activate_in_the_target_the_successor_arrives_inactive_and_gives_its_place_back(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $limited = $this->person('limited-mover', [$this->a]);
        $moderator = Role::where('organization_id', $this->b->id)->where('name', OrganizationRoleName::MODERATOR->value)->firstOrFail();
        app(PermissionRegistrar::class)->setPermissionsTeamId($this->b->id);
        $moderator->givePermissionTo([DevicePermission::MOVE->value, DevicePermission::MANAGE->value]);
        $this->join($limited, $this->b, OrganizationRoleName::MODERATOR);
        $count = app(DeviceLimit::class)->count($this->a->billingAccount)['total'];

        $this->actingAs($limited, 'sanctum');
        $review = $this->review($this->a, $this->b, [$x])->assertOk()->json();
        $this->assertFalse($review['devices'][0]['arrives_active']);
        $this->assertContains('1 active device arrives inactive, because you can’t activate devices in Harbour Shop.', $review['summary']);
        $move = $this->confirm($this->a, $this->b, [$x])->assertAccepted()->json('data');
        $this->answerStops();

        $successor = $this->successor($x);
        $this->assertSame(['registered', null, null], [$successor->lifecycle, $successor->desired_configuration_uuid, $successor->limit_place_at]);
        $this->assertSame($count - 1, app(DeviceLimit::class)->count($this->a->billingAccount)['total']);
        $done = $this->getJson($this->in($this->b).'/device-moves/'.$move['uuid'])->assertOk()->json('data');
        $this->assertSame([['kind' => 'device', 'uuid' => $successor->uuid, 'name' => 'Tracker X', 'reason' => 'Activate it in Harbour Shop.']], $done['needs_attention']);
    }

    public function test_moving_the_successor_back_gives_an_ordinary_device_with_a_free_code(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->applied($inB);

        $review = $this->review($this->b, $this->a, [$inB->fresh()])->assertOk()->json();
        // A keeps the archived device's code.
        $this->assertSame('tracker-x-2', $review['devices'][0]['successor']['code']);
        $this->moved($this->b, $this->a, [$inB->fresh()]);

        $back = $this->successor($inB);
        $this->assertSame([$this->a->id, 'tracker-x-2'], [$back->organization_id, $back->code]);
        $this->assertFalse($this->getJson($this->in($this->a).'/devices/'.$back->uuid)->assertOk()->json('data.pipe.hosted'));
        // Every version of one profile copies into one profile per organization: A's own profile is not reused, its copy is.
        $this->assertSame($this->a->id, DeviceProfile::whereKey(DeviceProfileArtifact::where('uuid', $back->draft['artifact_uuid'])->value('device_profile_id'))->value('organization_id'));
        $this->assertSame(1, DeviceInstallation::where('device_id', $back->id)->whereNull('ended_at')->count());
    }

    public function test_moving_onward_keeps_the_device_on_the_adapter_and_hosted_in_the_third_organization(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->applied($inB);

        $this->moved($this->b, $this->d, [$inB->fresh()]);

        $inD = $this->successor($inB);
        $this->assertSame($this->d->id, $inD->organization_id);
        $pipe = $this->getJson($this->in($this->d).'/devices/'.$inD->uuid)->assertOk()->json('data.pipe');
        $this->assertSame(['adapter', 'Integrator', true], [$pipe['kind'], $pipe['owner_organization_name'], $pipe['hosted']]);
        $this->assertSame($this->a->id, DeviceInstallation::where('device_id', $inD->id)->whereNull('ended_at')->value('organization_id'));
        $this->assertSame(['moved_to', 'Quay Store'], array_values(array_intersect_key($this->getJson($this->in($this->b).'/devices/'.$inB->uuid)->json('data.link'), array_flip(['direction', 'organization_name']))));
    }

    public function test_a_member_of_b_reconfigures_and_activates_the_hosted_device_on_its_held_source(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->applied($inB);
        $other = $this->adapterFed('WM-1002', 'Tracker Y');

        $this->actingAs($this->bOnly, 'sanctum');
        $device = $inB->fresh();
        $draft = [...$device->draft, 'draft_revision' => $device->draft_revision];
        $saved = $this->putJson($this->in($this->b).'/devices/'.$device->uuid.'/configuration', $draft)->assertOk()->json('data');
        $this->postJson($this->in($this->b).'/devices/'.$device->uuid.'/activate', ['draft_revision' => $saved['draft_revision']])->assertAccepted();
        // Another of A's sources can't be picked by hand.
        $device->refresh();
        $this->putJson($this->in($this->b).'/devices/'.$device->uuid.'/configuration', [...$draft, 'candidate_uuid' => $other->candidate->uuid, 'draft_revision' => $device->draft_revision])->assertNotFound();
    }

    public function test_archiving_the_hosted_device_in_b_frees_the_source_in_a(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->applied($inB);
        $adapter = $this->adapter();
        $candidate = AdapterCandidate::where('source_device_id', 'WM-1001')->firstOrFail();

        $sources = fn () => collect($this->as($this->aOnly, fn () => $this->getJson($this->in($this->a).'/device-adapters/'.$adapter->uuid.'/candidates')->assertOk()->json('data')))->keyBy('uuid');
        $this->assertSame(['organization_name' => 'Harbour Shop'], $sources()[$candidate->uuid]['in_use_in']);
        $this->assertNull($sources()[$candidate->uuid]['device']);

        $this->as($this->bOnly, function () use ($inB): void {
            $this->deactivated($inB);
            $this->postJson($this->in($this->b).'/devices/'.$inB->uuid.'/archive', ['draft_revision' => $inB->fresh()->draft_revision])->assertOk();
        });

        $this->assertSame('archived', DeviceInstallation::where('device_id', $inB->id)->value('ended_reason'));
        $this->assertNull($sources()[$candidate->uuid]['in_use_in']);
        $device = $this->as($this->mover, fn () => $this->postJson($this->in($this->a).'/device-adapters/'.$adapter->uuid.'/candidates/'.$candidate->uuid.'/activate', ['name' => 'Tracker X again'])->assertAccepted()->json('data.device'));
        $this->assertSame($this->a->id, Device::where('uuid', $device['uuid'])->value('organization_id'));
        $this->assertSame(3, DeviceInstallation::where('device_adapter_candidate_id', $candidate->id)->count());
        $this->assertSame(1, DeviceLink::count());
    }
}
