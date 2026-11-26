<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Audit\Models\Activity;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Entities\Models\ParameterPlacement;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/** Spec 009 US2 (parameters), US4 (explorer API), FR-010, FR-011, FR-017, research R9 and R17. */
final class PointsTest extends EntityTestCase
{
    /** @var array<string, string> parameter key => UUID, shared by every device of a profile */
    private array $uuids = [];

    private array $zone;

    /** What the runtime's latest-batch answers, by device UUID. */
    private array $runtime = [];

    private array $floor;

    protected function setUp(): void
    {
        parent::setUp();
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['http://runtime:8081/*' => fn () => Http::response(['data' => $this->runtime])]);
        $this->preset('buildings');
        $site = $this->entity('site', 'Campus', null, ['timezone' => 'UTC']);
        $building = $this->entity('building', 'North hall', $site['uuid']);
        $this->floor = $this->entity('floor', 'Floor 3', $building['uuid']);
        $this->zone = $this->entity('zone', 'Zone B', $this->floor['uuid']);
    }

    /** A device whose current configuration defines these parameters. */
    private function device(string $code, array $keys, ?string $at = null): Device
    {
        $device = Device::create(['organization_id' => $this->organization->id, 'code' => $code, 'name' => ucfirst($code)]);
        $this->configure($device, $keys, $at);

        return $device;
    }

    private function configure(Device $device, array $keys, ?string $at = null): void
    {
        $parameters = array_map(fn (string $key) => ['uuid' => $this->uuids[$code = $device->code.'|'.$key] ??= (string) Str::uuid(), 'key' => $key, 'label' => ucfirst($key), 'unit' => $key === 'energy' ? 'kWh' : null], $keys);
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => $device->code.'-'.Str::random(4), 'name' => 'Profile']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => ['parameters' => $parameters], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now()]);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => DeviceConfiguration::where('device_id', $device->id)->count() + 1,
            'definition_hash' => str_repeat('b', 64), 'definition' => ['profile_canonical_json' => json_encode(['parameters' => $parameters])], 'created_at' => $at ?? now()]);
        $device->forceFill(['last_applied_configuration_uuid' => $configuration->uuid])->save();
    }

    private function uuid(Device $device, string $key): string
    {
        return $this->uuids[$device->code.'|'.$key];
    }

    /** @return array<string, string> leaf name => state */
    private function points(array $entity, bool $branch = false): array
    {
        return collect($this->getJson($this->prefix.'/entities/'.$entity['uuid'].'/points'.($branch ? '?branch=1' : ''))->assertOk()->json('data'))
            ->mapWithKeys(fn ($point) => [$point['leaf_name'] => $point['state']])->sortKeys()->all();
    }

    public function test_a_parameter_placed_elsewhere_leaves_its_devices_place(): void
    {
        $meter = $this->device('meter', ['energy', 'voltage', 'temperature'], now()->subDay()->toDateTimeString());
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/placement', ['entity_uuid' => $this->zone['uuid']])->assertOk();
        $this->assertSame(['energy' => 'placed', 'temperature' => 'placed', 'voltage' => 'placed'], $this->points($this->zone));

        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.$this->uuid($meter, 'energy').'/placement', ['entity_uuid' => $this->floor['uuid'], 'leaf_name' => 'Ch3Energy'])
            ->assertOk()->assertJsonPath('data.path', 'Campus/NorthHall/Floor3/Ch3Energy');
        $this->assertSame(['temperature' => 'placed', 'voltage' => 'placed'], $this->points($this->zone));
        $this->assertSame(['Ch3Energy' => 'placed'], $this->points($this->floor));
        $this->assertSame(['Ch3Energy' => 'placed', 'temperature' => 'placed', 'voltage' => 'placed'], $this->points($this->floor, branch: true));
        $branch = collect($this->getJson($this->prefix.'/entities/'.$this->floor['uuid'].'/points?branch=1')->json('data'))->pluck('relative_path')->all();
        $this->assertSame(['Ch3Energy', 'ZoneB/temperature', 'ZoneB/voltage'], $branch);
        $this->getJson($this->prefix.'/devices/'.$meter->uuid)->assertOk()->assertJsonPath('data.parameter_placements.0.path', 'Campus/NorthHall/Floor3/Ch3Energy');
        $this->assertSame(1, Activity::where('event', 'parameter.placed')->count());

        // Back to the device's place.
        $this->deleteJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.$this->uuid($meter, 'energy').'/placement')->assertNoContent();
        $this->assertSame(['energy' => 'placed', 'temperature' => 'placed', 'voltage' => 'placed'], $this->points($this->zone));
    }

    public function test_names_are_unique_at_an_entity_and_a_clash_is_refused_with_the_names(): void
    {
        $first = $this->device('first', ['temperature', 'humidity']);
        $second = $this->device('second', ['temperature', 'co2']);
        $this->putJson($this->prefix.'/devices/'.$first->uuid.'/placement', ['entity_uuid' => $this->zone['uuid']])->assertOk();

        $this->putJson($this->prefix.'/devices/'.$second->uuid.'/placement', ['entity_uuid' => $this->zone['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['leaf_names' => 'These names are already used at Campus/NorthHall/Floor3/ZoneB: temperature.']);
        $this->putJson($this->prefix.'/devices/'.$second->uuid.'/placement', ['entity_uuid' => $this->zone['uuid'], 'leaf_names' => [$this->uuid($second, 'temperature') => 'ReturnAirTemperature']])->assertOk();
        $this->assertSame(['ReturnAirTemperature' => 'placed', 'co2' => 'placed', 'humidity' => 'placed', 'temperature' => 'placed'], $this->points($this->zone));

        // A parameter placement, a child entity and a point share one set of names.
        $this->putJson($this->prefix.'/devices/'.$second->uuid.'/parameters/'.$this->uuid($second, 'co2').'/placement', ['entity_uuid' => $this->zone['uuid'], 'leaf_name' => 'Humidity'])
            ->assertUnprocessable()->assertJsonValidationErrors('leaf_name');
        $this->putJson($this->prefix.'/devices/'.$second->uuid.'/parameters/'.$this->uuid($second, 'co2').'/placement', ['entity_uuid' => $this->zone['uuid'], 'leaf_name' => 'bad name'])
            ->assertUnprocessable()->assertJsonValidationErrors('leaf_name');
        $this->postJson($this->prefix.'/entities', ['type_key' => 'room', 'name' => 'humidity', 'parent_uuid' => $this->zone['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['path_name' => 'already uses the name Humidity here']);
        $room = $this->entity('room', 'Room 1', $this->zone['uuid']);
        $this->putJson($this->prefix.'/devices/'.$second->uuid.'/parameters/'.$this->uuid($second, 'co2').'/placement', ['entity_uuid' => $this->zone['uuid'], 'leaf_name' => 'Room1'])
            ->assertUnprocessable()->assertJsonValidationErrors('leaf_name');
        $this->assertNotEmpty($room);
    }

    public function test_a_profile_upgrade_that_clashes_reports_the_new_parameter_and_never_blocks(): void
    {
        $first = $this->device('first', ['temperature'], now()->subDays(2)->toDateTimeString());
        $second = $this->device('second', ['pressure'], now()->subDays(2)->toDateTimeString());
        $this->putJson($this->prefix.'/devices/'.$first->uuid.'/placement', ['entity_uuid' => $this->zone['uuid']])->assertOk();
        $this->putJson($this->prefix.'/devices/'.$second->uuid.'/placement', ['entity_uuid' => $this->zone['uuid']])->assertOk();

        // The first device's profile gains `pressure` later.
        $this->configure($first, ['temperature', 'pressure'], now()->addMinute()->toDateTimeString());
        $points = collect($this->getJson($this->prefix.'/entities/'.$this->zone['uuid'].'/points')->json('data'));
        $this->assertSame('placed', $points->firstWhere(fn ($p) => $p['device']['uuid'] === $second->uuid)['state'], 'the point that was there keeps its name');
        $this->assertSame('name_clash', $points->firstWhere(fn ($p) => $p['device']['uuid'] === $first->uuid && $p['parameter']['key'] === 'pressure')['state']);
    }

    public function test_a_parameter_the_configuration_no_longer_has_is_kept_and_reported(): void
    {
        $meter = $this->device('meter', ['energy', 'voltage']);
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.$this->uuid($meter, 'energy').'/placement', ['entity_uuid' => $this->floor['uuid']])->assertOk();
        $this->configure($meter, ['voltage']);
        $this->assertSame(['energy' => 'not_in_configuration'], $this->points($this->floor));
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.Str::uuid().'/placement', ['entity_uuid' => $this->floor['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors('parameter');
    }

    public function test_points_carry_latest_values_and_an_unknown_one_is_null(): void
    {
        $meter = $this->device('meter', ['energy', 'voltage']);
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/placement', ['entity_uuid' => $this->zone['uuid']])->assertOk();
        $this->runtime = [$meter->uuid => ['data' => [
            ['parameter_uuid' => $this->uuid($meter, 'energy'), 'value' => 1250.5, 'quality' => 'good', 'observed_at' => '2026-11-25T10:00:00Z', 'received_at' => '2026-11-25T10:00:02Z'],
        ]]];
        $points = collect($this->getJson($this->prefix.'/entities/'.$this->zone['uuid'].'/points')->assertOk()->json('data'))->keyBy('leaf_name');
        $this->assertSame(1250.5, $points['energy']['latest']['value']);
        $this->assertSame('kWh', $points['energy']['parameter']['unit']);
        $this->assertNull($points['voltage']['latest'], 'unknown, never zero');
        Http::assertSent(fn ($request) => str_contains($request->url(), 'latest-batch') && str_contains(urldecode($request->url()), $meter->uuid));
    }

    public function test_archiving_ends_parameter_placements_and_an_entity_holding_one_cannot_be_archived(): void
    {
        $meter = $this->device('meter', ['energy']);
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.$this->uuid($meter, 'energy').'/placement', ['entity_uuid' => $this->zone['uuid']])->assertOk();
        $this->postJson($this->prefix.'/entities/'.$this->zone['uuid'].'/archive')->assertUnprocessable();

        $this->postJson($this->prefix.'/devices/'.$meter->uuid.'/archive', ['draft_revision' => $meter->fresh()->draft_revision])->assertOk();
        $this->assertNotNull(ParameterPlacement::where('device_id', $meter->id)->sole()->ended_at);
        $this->postJson($this->prefix.'/entities/'.$this->zone['uuid'].'/archive')->assertOk();
        $this->deleteJson($this->prefix.'/entities/'.$this->zone['uuid'])->assertUnprocessable()->assertJsonValidationErrors(['entity' => 'entities or devices']);
    }
}
