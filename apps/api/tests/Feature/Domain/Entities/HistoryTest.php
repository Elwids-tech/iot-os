<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/** Spec 009 US6 (where was it, and when), FR-012 and research R12; quickstart G. */
final class HistoryTest extends EntityTestCase
{
    /** @var array<string, array<string, mixed>> */
    private array $plant;

    /** @var array<string, string> moment => ISO time */
    private array $at = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => []])]);
        $this->travelTo(Carbon::parse('2026-11-01 08:00:00', 'UTC'));
        $this->preset('manufacturing');
        $site = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $this->plant = [
            'site' => $site,
            'packaging' => $packaging = $this->entity('area', 'Packaging', $site['uuid']),
            'assembly' => $this->entity('area', 'Assembly', $site['uuid']),
            'line1' => $this->entity('line', 'Line 1', $packaging['uuid']),
            'line2' => $this->entity('line', 'Line 2', $packaging['uuid']),
        ];
    }

    private function later(string $moment): void
    {
        $this->travel(1)->hours();
        $this->at[$moment] = now()->toIso8601String();
        $this->travel(1)->hours();
    }

    /** Line 1 → Line 2, rename Line 2, Line 2 under Assembly (the independent test of US6). */
    private function story(Device $pump): void
    {
        $this->later('before placing');
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $this->plant['line1']['uuid']])->assertOk();
        $this->later('on line 1');
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $this->plant['line2']['uuid']])->assertOk();
        $this->later('on line 2');
        $this->patchJson($this->prefix.'/entities/'.$this->plant['line2']['uuid'], ['name' => 'Bottling', 'path_name' => 'Bottling'])->assertOk();
        $this->later('renamed');
        $this->postJson($this->prefix.'/entities/'.$this->plant['line2']['uuid'].'/move', ['parent_uuid' => $this->plant['assembly']['uuid']])->assertOk();
        $this->later('moved');
    }

    private function pump(): Device
    {
        return Device::create(['organization_id' => $this->organization->id, 'code' => 'pump-1', 'name' => 'Pump 1']);
    }

    /** @return list<string> device names, then leaf names for points */
    private function branchAt(string $entity, string $moment): array
    {
        return collect($this->getJson($this->prefix.'/entities/'.$this->plant[$entity]['uuid'].'/branch-at?time='.urlencode($this->at[$moment]))->assertOk()->json('data'))
            ->map(fn (array $row) => $row['kind'] === 'device' ? $row['device']['name'] : $row['device']['name'].'/'.$row['leaf_name'])->all();
    }

    public function test_a_devices_history_lists_its_placements_with_times_and_who(): void
    {
        $pump = $this->pump();
        $this->story($pump);

        $events = $this->getJson($this->prefix.'/devices/'.$pump->uuid.'/place-history')->assertOk()->assertJsonPath('meta.total', 3)->json('data');
        $this->assertSame(
            [['device_placed', 'Bottling', null], ['device_removed', 'Line 1', 'moved'], ['device_placed', 'Line 1', null]],
            array_map(fn ($e) => [$e['kind'], $e['entity']['name'], $e['end_reason']], $events),
        );
        $this->assertSame('Shared Operations Admin', $events[0]['user']['name']);
        $this->assertSame($events[0]['at'], $events[1]['at'], 'the move ends one placement as the next starts');
        $this->assertSame('RiversidePlant/Assembly/Bottling', $events[0]['entity']['path'], 'paths are as they are today');
    }

    public function test_a_parameter_placed_on_its_own_is_in_its_devices_history(): void
    {
        $meter = $this->pump();
        $parameter = (string) Str::uuid();
        $definition = ['parameters' => [['uuid' => $parameter, 'key' => 'energy', 'label' => 'Energy', 'unit' => 'kWh']]];
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => 'meter-profile', 'name' => 'Meter']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now()]);
        $configuration = DeviceConfiguration::create(['device_id' => $meter->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1,
            'definition_hash' => str_repeat('b', 64), 'definition' => ['profile_canonical_json' => json_encode($definition)], 'created_at' => now()]);
        $meter->forceFill(['last_applied_configuration_uuid' => $configuration->uuid])->save();
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/placement', ['entity_uuid' => $this->plant['line1']['uuid']])->assertOk();
        $this->later('placed');
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.$parameter.'/placement', ['entity_uuid' => $this->plant['line2']['uuid'], 'leaf_name' => 'Ch3Energy'])->assertOk();
        $this->later('point placed');
        $this->deleteJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.$parameter.'/placement')->assertNoContent();

        $events = $this->getJson($this->prefix.'/devices/'.$meter->uuid.'/place-history')->assertOk()->json('data');
        $this->assertSame(['point_removed', 'point_placed', 'device_placed'], array_column($events, 'kind'));
        $this->assertSame(['uuid' => $parameter, 'key' => 'energy', 'leaf_name' => 'Ch3Energy'], $events[1]['parameter']);
        $this->assertSame('Line 2', $events[1]['entity']['name']);
        $this->assertSame(['Pump 1/Ch3Energy'], array_values(array_filter($this->branchAt('line2', 'point placed'), fn ($r) => str_contains($r, '/'))));
        $this->assertSame([], $this->getJson($this->prefix.'/entities/'.$this->plant['line2']['uuid'].'/branch-at?time='.urlencode(now()->toIso8601String()))->json('data'));
        $this->assertSame(['point_removed', 'point_placed', 'created'], array_column($this->getJson($this->prefix.'/entities/'.$this->plant['line2']['uuid'].'/history')->json('data'), 'kind'));
    }

    public function test_an_entitys_history_lists_its_moves_renames_and_devices(): void
    {
        $pump = $this->pump();
        $this->story($pump);

        $events = $this->getJson($this->prefix.'/entities/'.$this->plant['line2']['uuid'].'/history')->assertOk()->json('data');
        $this->assertSame(['moved', 'renamed', 'device_placed', 'created'], array_column($events, 'kind'));
        $this->assertSame(['Packaging', 'Assembly'], [$events[0]['old_parent']['name'], $events[0]['new_parent']['name']]);
        $this->assertSame(['Line2', 'Bottling'], [$events[1]['old_path_name'], $events[1]['new_path_name']]);
        $this->assertSame('Pump 1', $events[2]['device']['name']);
        $this->assertSame(['key' => 'line', 'name' => 'Line'], $events[3]['new_type']);
        $this->assertSame('Shared Operations Admin', $events[0]['user']['name']);

        $this->assertSame(['device_removed', 'device_placed', 'created'], array_column($this->getJson($this->prefix.'/entities/'.$this->plant['line1']['uuid'].'/history')->json('data'), 'kind'));
    }

    public function test_a_branch_at_a_past_time_uses_the_tree_as_it_was_then(): void
    {
        $this->story($this->pump());

        $this->assertSame([], $this->branchAt('line1', 'before placing'));
        $this->assertSame(['Pump 1'], $this->branchAt('line1', 'on line 1'));
        $this->assertSame([], $this->branchAt('line1', 'on line 2'), 'after the move Line 1 no longer has it');
        $this->assertSame(['Pump 1'], $this->branchAt('packaging', 'renamed'), 'Line 2 was still under Packaging');
        $this->assertSame([], $this->branchAt('packaging', 'moved'));
        $this->assertSame([], $this->branchAt('assembly', 'renamed'));
        $this->assertSame(['Pump 1'], $this->branchAt('assembly', 'moved'));
        $this->assertSame(['Pump 1'], $this->branchAt('site', 'on line 1'));
    }

    public function test_an_entity_that_did_not_exist_yet_has_an_empty_branch(): void
    {
        $this->getJson($this->prefix.'/entities/'.$this->plant['line1']['uuid'].'/branch-at?time='.urlencode('2026-10-01T00:00:00Z'))->assertOk()
            ->assertJsonPath('meta.existed', false)->assertJsonCount(0, 'data');
        $this->getJson($this->prefix.'/entities/'.$this->plant['line1']['uuid'].'/branch-at?time='.urlencode(now()->toIso8601String()))->assertOk()
            ->assertJsonPath('meta.existed', true);
        $this->getJson($this->prefix.'/entities/'.$this->plant['line1']['uuid'].'/branch-at?time='.urlencode(now()->addDay()->toIso8601String()))
            ->assertUnprocessable()->assertJsonValidationErrors('time');
        $this->getJson($this->prefix.'/entities/'.$this->plant['line1']['uuid'].'/branch-at')->assertUnprocessable()->assertJsonValidationErrors('time');
    }

    public function test_migrated_placements_with_no_start_count_as_open_earlier(): void
    {
        $pump = $this->pump();
        $this->later('before placing');
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $this->plant['line1']['uuid']])->assertOk();
        // As the site migration left it: placed "since before history was kept".
        EntityPlacement::query()->where('device_id', $pump->id)->update(['started_at' => null, 'started_by' => null]);

        $this->assertSame(['Pump 1'], $this->branchAt('line1', 'before placing'));
        $events = $this->getJson($this->prefix.'/devices/'.$pump->uuid.'/place-history')->assertOk()->json('data');
        $this->assertSame([['device_placed', null, null]], array_map(fn ($e) => [$e['kind'], $e['at'], $e['user']], $events));
        $this->assertSame(['created', 'device_placed'], array_column($this->getJson($this->prefix.'/entities/'.$this->plant['line1']['uuid'].'/history')->json('data'), 'kind'), 'undated starts sort last');
    }

    public function test_history_needs_entity_view_and_stays_in_its_organization(): void
    {
        $pump = $this->pump();
        $northstar = Organization::where('slug', '!=', 'acme-manufacturing')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/entities/'.$this->plant['line1']['uuid'].'/history')->assertNotFound();
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/devices/'.$pump->uuid.'/place-history')->assertNotFound();
    }
}
