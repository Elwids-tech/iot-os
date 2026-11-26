<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Audit\Models\Activity;
use App\Domain\Automation\Models\Alert;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Entities\Models\EntityMembership;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/** Spec 009 US1 AS7, US2 AS7, FR-016, FR-023, SC-005: memberships, coverage and the entity filters. */
final class MembershipsTest extends EntityTestCase
{
    private array $north;

    private array $substation;

    private array $feeder;

    private array $transformer;

    private array $east;

    private Device $monitor;

    protected function setUp(): void
    {
        parent::setUp();
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => []])]);
        $this->preset('power_distribution');
        $this->north = $this->entity('region', 'North', null, ['timezone' => 'UTC']);
        $this->substation = $this->entity('substation', 'Eastgate SS', $this->north['uuid']);
        $this->feeder = $this->entity('feeder', 'Feeder 12', $this->substation['uuid']);
        $this->transformer = $this->entity('distribution_transformer', 'Transformer 05', $this->feeder['uuid']);
        $this->east = $this->entity('division', 'East Division', $this->north['uuid']);

        $this->monitor = Device::create(['organization_id' => $this->organization->id, 'code' => 'tx05-monitor', 'name' => 'Transformer 05 monitor']);
        $oil = (string) Str::uuid();
        $parameters = [['uuid' => $oil, 'key' => 'oil_temp', 'label' => 'Oil temperature', 'unit' => '°C']];
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => 'tx-monitor', 'name' => 'Transformer monitor']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => ['parameters' => $parameters], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now()]);
        $configuration = DeviceConfiguration::create(['device_id' => $this->monitor->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64),
            'definition' => ['profile_canonical_json' => json_encode(['parameters' => $parameters])], 'created_at' => now()]);
        $this->monitor->forceFill(['last_applied_configuration_uuid' => $configuration->uuid])->save();
        $this->putJson($this->prefix.'/devices/'.$this->monitor->uuid.'/placement', ['entity_uuid' => $this->transformer['uuid'], 'leaf_names' => [$oil => 'OilTemperature']])->assertOk();
    }

    /** @return list<string> */
    private function devicesIn(array $entity): array
    {
        return collect($this->getJson($this->prefix.'/devices?entity_uuid='.$entity['uuid'])->assertOk()->json('data'))->pluck('name')->all();
    }

    private function join(array $member, array $group): TestResponse
    {
        return $this->postJson($this->prefix.'/entities/'.$member['uuid'].'/memberships', ['group_uuid' => $group['uuid']]);
    }

    public function test_a_feeder_in_a_division_brings_its_branch_into_the_divisions_coverage(): void
    {
        $this->assertSame([], $this->devicesIn($this->east));
        $this->assertSame(['Transformer 05 monitor'], $this->devicesIn($this->feeder));

        $this->join($this->feeder, $this->east)->assertOk()->assertJsonPath('data.group.path', 'North/EastDivision');

        // SC-005: the division's filter includes the monitor, whose path does not change.
        $this->assertSame(['Transformer 05 monitor'], $this->devicesIn($this->east));
        $points = $this->getJson($this->prefix.'/entities/'.$this->east['uuid'].'/points?branch=1')->assertOk()->json('data');
        $this->assertSame([['North/EastgateSS/Feeder12/Transformer05/OilTemperature', 'North/EastgateSS/Feeder12/Transformer05/OilTemperature']], array_map(fn ($p) => [$p['path'], $p['relative_path']], $points));
        $this->getJson($this->prefix.'/entities/'.$this->feeder['uuid'])->assertOk()->assertJsonPath('data.path', 'North/EastgateSS/Feeder12')->assertJsonPath('data.parent_uuid', $this->substation['uuid']);
        $this->getJson($this->prefix.'/devices/'.$this->monitor->uuid)->assertOk()->assertJsonPath('data.entity.path', 'North/EastgateSS/Feeder12/Transformer05');

        $listed = $this->getJson($this->prefix.'/entities/'.$this->east['uuid'].'/memberships')->assertOk();
        $listed->assertJsonPath('data.members.0.member.path', 'North/EastgateSS/Feeder12')->assertJsonPath('data.members.0.ended_at', null)->assertJsonPath('data.groups', []);
        $this->getJson($this->prefix.'/entities/'.$this->feeder['uuid'].'/memberships')->assertOk()->assertJsonPath('data.groups.0.group.type_key', 'division');
        $this->assertSame(1, Activity::where('event', 'entity.membership_started')->count());
    }

    public function test_joining_a_second_division_ends_the_first(): void
    {
        $west = $this->entity('division', 'West Division', $this->north['uuid']);
        $this->join($this->feeder, $this->east)->assertOk();
        $this->join($this->feeder, $this->east)->assertOk();
        $this->assertSame(1, EntityMembership::count());

        $this->join($this->feeder, $west)->assertOk();
        $this->assertSame([], $this->devicesIn($this->east));
        $this->assertSame(['Transformer 05 monitor'], $this->devicesIn($west));
        $groups = $this->getJson($this->prefix.'/entities/'.$this->feeder['uuid'].'/memberships')->assertOk()->json('data.groups');
        $this->assertSame([['North/WestDivision', null], ['North/EastDivision', 'replaced']], array_map(fn ($g) => [$g['group']['path'], $g['end_reason']], $groups));

        // Several memberships of different group types are allowed; leaving ends only that one.
        $this->deleteJson($this->prefix.'/entities/'.$this->feeder['uuid'].'/memberships/'.$west['uuid'])->assertNoContent();
        $this->assertSame([], $this->devicesIn($west));
        $this->assertSame(0, EntityMembership::whereNull('ended_at')->count());
    }

    public function test_memberships_refuse_self_relatives_and_types_the_group_does_not_hold(): void
    {
        $this->join($this->east, $this->east)->assertStatus(422)->assertJsonValidationErrors('group_uuid');
        // The region is the division's ancestor: the tree already relates them.
        $this->join($this->north, $this->east)->assertStatus(422)->assertJsonPath('errors.group_uuid.0', 'East Division is inside North: the tree already relates them.');
        $meter = $this->entity('meter', 'Meter 7', $this->transformer['uuid']);
        $this->join($meter, $this->east)->assertStatus(422)->assertJsonPath('errors.group_uuid.0', 'A Division cannot hold a Meter as a member.');
        $this->join($this->feeder, ['uuid' => (string) Str::uuid()])->assertStatus(422)->assertJsonValidationErrors('group_uuid');
        $this->assertSame(0, EntityMembership::count());
    }

    public function test_moving_a_member_keeps_it_and_archiving_either_side_ends_it(): void
    {
        $other = $this->entity('substation', 'Westgate SS', $this->north['uuid']);
        $this->join($this->feeder, $this->east)->assertOk();
        $this->postJson($this->prefix.'/entities/'.$this->feeder['uuid'].'/move', ['parent_uuid' => $other['uuid']])->assertOk();
        $this->assertSame(['Transformer 05 monitor'], $this->devicesIn($this->east));

        $this->postJson($this->prefix.'/entities/'.$this->east['uuid'].'/archive')->assertOk();
        $this->assertSame('archived', EntityMembership::sole()->end_reason);
        $this->assertSame(1, Activity::where('event', 'entity.membership_ended')->count());
        // A grouping is history: the division can no longer be deleted outright.
        $this->deleteJson($this->prefix.'/entities/'.$this->east['uuid'])->assertStatus(422);
        $this->join($this->feeder, $this->east)->assertStatus(422);
    }

    public function test_alerts_filter_by_an_entitys_coverage(): void
    {
        $elsewhere = Device::create(['organization_id' => $this->organization->id, 'code' => 'elsewhere', 'name' => 'Elsewhere']);
        foreach ([$this->monitor, $elsewhere] as $i => $device) {
            $alert = Alert::create(['organization_id' => $this->organization->id, 'kind' => Alert::DEVICE_OFFLINE, 'episode' => 1, 'episode_key' => 'device:'.$device->uuid.'#1', 'subject_device_id' => $device->id,
                'cause' => 'missed_check_in', 'offline_since' => now()->subHour(), 'activated_at' => now()->subMinutes(58 - $i)]);
            $alert->devices()->attach($device->id);
        }
        $listed = fn (array $entity) => collect($this->getJson($this->prefix.'/alerts?entity_uuid='.$entity['uuid'])->assertOk()->json('data'))->pluck('subject.name')->all();

        $this->assertSame(['Transformer 05 monitor'], $listed($this->substation));
        $this->assertSame([], $listed($this->east));
        $this->join($this->feeder, $this->east)->assertOk();
        $this->assertSame(['Transformer 05 monitor'], $listed($this->east));
        $this->getJson($this->prefix.'/alerts?entity_uuid='.Str::uuid())->assertOk()->assertJsonPath('data', []);
    }

    public function test_another_organization_and_viewers_cannot_change_memberships(): void
    {
        $this->actAs('acme.member@example.test');
        $this->getJson($this->prefix.'/entities/'.$this->feeder['uuid'].'/memberships')->assertOk();
        $this->join($this->feeder, $this->east)->assertForbidden();

        $this->actAs('northstar.admin@example.test');
        $this->getJson($this->prefix.'/entities/'.$this->feeder['uuid'].'/memberships')->assertForbidden();
        $this->join($this->feeder, $this->east)->assertForbidden();
        $this->assertSame(0, EntityMembership::count());
    }

    public function test_the_scale_seeder_builds_a_tree_it_can_measure_and_remove(): void
    {
        $entities = DB::table('entities')->count();
        $this->assertSame(0, Artisan::call('entities:seed-scale', ['organization' => $this->organization->uuid, '--entities' => 230, '--devices' => 40]));
        $site = DB::table('entities')->where('organization_id', $this->organization->id)->where('path_name', 'Scale')->first();
        $this->assertSame(231, DB::table('entity_closure')->where('ancestor_id', $site->id)->count());
        $this->assertSame(40, DB::table('entity_placements')->join('devices', 'devices.id', '=', 'entity_placements.device_id')->where('devices.site_id', $site->id)->whereNull('ended_at')->count());
        $this->assertStringContainsString('resolve a 50-entity scope', Artisan::output());
        $this->assertSame(['Node1', 'Node10', 'Node2'], collect($this->getJson($this->prefix.'/entities?parent='.$site->uuid)->assertOk()->json('data'))->pluck('path_name')->take(3)->all());

        $this->assertSame(0, Artisan::call('entities:seed-scale', ['organization' => $this->organization->uuid, '--remove' => true]));
        $this->assertSame($entities, DB::table('entities')->count());
        $this->assertSame(0, DB::table('devices')->where('code', 'like', 'scale-%')->count());
    }
}
