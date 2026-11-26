<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\Site;
use App\Domain\Entities\Services\DeviceAnchors;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Applications follow entities (spec 009 PR 8, FR-026, contracts/integration.md): a scope
 * names entities of any type and covers the devices anchored in their branches, resolved
 * afresh on every request; `entities:read` serves the visible hierarchy and the device's
 * points; quickstart H.
 */
final class ApplicationScopeTest extends EntityTestCase
{
    /** @var array<string, array<string, mixed>> */
    private array $plant;

    private string $read;

    protected function setUp(): void
    {
        parent::setUp();
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => []])]);
        $this->preset('manufacturing');
        $site = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $this->plant = [
            'site' => $site,
            'zoneA' => $zoneA = $this->entity('area', 'Zone A', $site['uuid']),
            'zoneB' => $zoneB = $this->entity('area', 'Zone B', $site['uuid']),
            'lineA' => $this->entity('line', 'Line A', $zoneA['uuid']),
            'lineB' => $this->entity('line', 'Line B', $zoneB['uuid']),
        ];
        $this->read = '/api/integration/v1/organizations/'.$this->organization->uuid;
    }

    private function device(string $code, ?string $at): Device
    {
        $device = Device::create(['organization_id' => $this->organization->id, 'code' => $code, 'name' => ucfirst($code)]);
        if ($at !== null) {
            $this->putJson($this->prefix.'/devices/'.$device->uuid.'/placement', ['entity_uuid' => $this->plant[$at]['uuid']])->assertOk();
        }

        return $device;
    }

    /** @param  array<string, mixed>  $grant */
    private function application(array $grant, array $abilities = ['devices:read', 'entities:read']): array
    {
        return $this->postJson($this->prefix.'/applications', ['name' => 'Twin', 'abilities' => $abilities, ...$grant])->assertCreated()->json('data');
    }

    private function token(array $application): string
    {
        return $this->postJson($this->prefix.'/applications/'.$application['uuid'].'/token', ['revision' => $application['revision'], 'abilities' => $application['abilities'], 'expires_in_days' => 1])
            ->assertCreated()->json('data.token');
    }

    private function asApplication(string $token, string $path): TestResponse
    {
        $response = $this->withToken($token)->getJson($this->read.$path);
        $this->withoutToken();

        return $response;
    }

    /** @return list<string> */
    private function granted(string $token): array
    {
        return collect($this->asApplication($token, '/devices?per_page=100')->assertOk()->json('data'))->pluck('code')->sort()->values()->all();
    }

    public function test_a_scope_on_a_zone_grants_the_devices_below_it_and_not_its_siblings(): void
    {
        $this->device('at-zone-b', 'zoneB');
        $this->device('on-line-b', 'lineB');
        $this->device('on-line-a', 'lineA');
        $this->device('at-site', 'site');
        $this->device('unplaced', null);

        $application = $this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]]);
        $this->assertSame([$this->plant['zoneB']['uuid']], $application['entity_uuids']);
        $this->assertSame([['uuid' => $this->plant['zoneB']['uuid'], 'name' => 'Zone B', 'path' => 'RiversidePlant/ZoneB', 'type_key' => 'area']], $application['entities']);
        $this->assertNull($application['site_uuids'], 'a scope that is not all sites has no site view');
        $this->assertSame(['at-zone-b', 'on-line-b'], $this->granted($this->token($application)));
    }

    public function test_a_site_scope_is_an_entity_scope_and_keeps_its_site_view(): void
    {
        $this->device('on-line-a', 'lineA');
        $application = $this->application(['site_uuids' => [$this->plant['site']['uuid']]]);
        $this->assertSame([$this->plant['site']['uuid']], $application['entity_uuids']);
        $this->assertSame([$this->plant['site']['uuid']], $application['site_uuids']);
        $this->assertSame([['uuid' => $this->plant['site']['uuid'], 'name' => 'Riverside plant']], $application['sites']);
        $this->assertSame(['on-line-a'], $this->granted($this->token($application)));

        // A site scope names Site entities only, and never with entity_uuids.
        $this->postJson($this->prefix.'/applications', ['name' => 'Twin', 'abilities' => ['devices:read'], 'site_uuids' => [$this->plant['zoneA']['uuid']]])
            ->assertUnprocessable()->assertJsonPath('message', 'Every site must belong to this organization.');
        $this->postJson($this->prefix.'/applications', ['name' => 'Twin', 'abilities' => ['devices:read'], 'site_uuids' => [$this->plant['site']['uuid']], 'entity_uuids' => [$this->plant['zoneA']['uuid']]])
            ->assertUnprocessable()->assertJsonValidationErrors('entity_uuids');
        $this->postJson($this->prefix.'/applications', ['name' => 'Twin', 'abilities' => ['devices:read'], 'device_uuids' => [Device::firstOrFail()->uuid], 'entity_uuids' => [$this->plant['zoneA']['uuid']]])
            ->assertUnprocessable()->assertJsonValidationErrors('device_uuids');
    }

    public function test_moving_a_branch_out_of_a_scope_revokes_at_once_and_the_move_says_so(): void
    {
        $this->device('on-line-b', 'lineB');
        $application = $this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]]);
        $token = $this->token($application);
        $this->assertSame(['on-line-b'], $this->granted($token));

        $this->getJson($this->prefix.'/entities/'.$this->plant['lineB']['uuid'].'/move-impact?parent='.$this->plant['zoneA']['uuid'])->assertOk()
            ->assertJsonPath('data.applications', [['uuid' => $application['uuid'], 'name' => 'Twin', 'gains' => 0, 'loses' => 1]]);
        $this->postJson($this->prefix.'/entities/'.$this->plant['lineB']['uuid'].'/move', ['parent_uuid' => $this->plant['zoneA']['uuid']])->assertOk();
        $this->assertSame([], $this->granted($token), 'the next read no longer has it');

        $this->getJson($this->prefix.'/entities/'.$this->plant['lineB']['uuid'].'/move-impact?parent='.$this->plant['zoneB']['uuid'])->assertOk()
            ->assertJsonPath('data.applications', [['uuid' => $application['uuid'], 'name' => 'Twin', 'gains' => 1, 'loses' => 0]]);
        // A scope inside the moving branch keeps its devices: nothing to report.
        $inner = $this->application(['entity_uuids' => [$this->plant['lineB']['uuid']]]);
        $this->assertNotContains($inner['uuid'], array_column($this->getJson($this->prefix.'/entities/'.$this->plant['lineB']['uuid'].'/move-impact?parent='.$this->plant['zoneB']['uuid'])->json('data.applications'), 'uuid'));
    }

    public function test_an_archived_device_stays_granted_at_its_last_anchor(): void
    {
        $device = $this->device('retired', 'lineB');
        $token = $this->token($this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]]));
        $device->forceFill(['lifecycle' => 'archived'])->save();
        DB::table('entity_placements')->where('device_id', $device->id)->update(['ended_at' => now()]);
        app(DeviceAnchors::class)->refreshDevices([$device->id]);

        $this->assertSame($this->plant['lineB']['uuid'], DB::table('entities')->where('id', $device->fresh()->entity_id)->value('uuid'));
        $this->assertSame(['retired'], $this->granted($token));
    }

    public function test_an_archived_entity_leaves_every_scope(): void
    {
        $application = $this->application(['entity_uuids' => [$this->plant['lineA']['uuid'], $this->plant['zoneB']['uuid']]]);
        $this->postJson($this->prefix.'/entities/'.$this->plant['lineA']['uuid'].'/archive')->assertOk();

        $fresh = IntegrationApplication::where('uuid', $application['uuid'])->firstOrFail();
        $this->assertSame([$this->plant['zoneB']['uuid']], $fresh->entity_uuids);
        $this->assertSame($application['grant_revision'] + 1, $fresh->grant_revision);
        $audit = json_decode((string) DB::table('activity_log')->where('event', 'application.grants_updated')->where('subject_uuid', $application['uuid'])->latest('id')->value('properties'), true);
        $this->assertSame(['entity_archived', $this->plant['lineA']['uuid']], [$audit['reason'], $audit['entity_uuid']]);
    }

    public function test_another_organizations_entity_is_refused_and_never_resolves(): void
    {
        $northstar = Organization::where('slug', '!=', 'acme-manufacturing')->firstOrFail();
        $foreign = DB::table('entities')->where('organization_id', '!=', $this->organization->id)->value('uuid')
            ?? Site::create(['organization_id' => $northstar->id, 'name' => 'Foreign plant'])->uuid;
        $this->postJson($this->prefix.'/applications', ['name' => 'Twin', 'abilities' => ['devices:read'], 'entity_uuids' => [$foreign]])
            ->assertUnprocessable()->assertJsonPath('message', 'Every entity must belong to this organization.');
        $this->postJson($this->prefix.'/applications', ['name' => 'Twin', 'abilities' => ['devices:read'], 'entity_uuids' => [(string) Str::uuid()]])
            ->assertUnprocessable()->assertJsonPath('message', 'Every entity must belong to this organization.');

        // A scope that somehow names one resolves to nothing, and the other organization's URL is 404.
        $this->device('on-line-b', 'lineB');
        $application = $this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]]);
        $token = $this->token($application);
        IntegrationApplication::where('uuid', $application['uuid'])->update(['entity_uuids' => json_encode([$foreign])]);
        $this->assertSame([], $this->granted($token));
        $this->assertSame([], $this->asApplication($token, '/entities')->assertOk()->json('data'));
        $this->withToken($token)->getJson('/api/integration/v1/organizations/'.$northstar->uuid.'/entities')->assertNotFound();
        $this->withoutToken();
    }

    public function test_entities_lists_the_scoped_branches_and_the_ancestors_that_complete_their_paths(): void
    {
        $this->device('on-line-a', 'lineA');
        $application = $this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]]);
        $token = $this->token($application);

        $body = $this->asApplication($token, '/entities')->assertOk()->assertJsonPath('schema_version', 'integration-entities.v1')->assertJsonPath('next_cursor', null)->json();
        $this->assertSame([
            ['RiversidePlant', false, null],
            ['RiversidePlant/ZoneB', true, $this->plant['site']['uuid']],
            ['RiversidePlant/ZoneB/LineB', true, $this->plant['zoneB']['uuid']],
        ], array_map(fn ($e) => [$e['path'], $e['in_scope'], $e['parent_uuid']], $body['data']));
        $this->assertSame('line', $body['data'][2]['type_key']);
        // The site is shown to complete the path; its other devices are not granted.
        $this->assertSame([], $this->granted($token));

        // A device list sees its devices' places and their ancestors, none of them in scope.
        $list = $this->token($this->application(['device_uuids' => [Device::where('code', 'on-line-a')->firstOrFail()->uuid]]));
        $this->assertSame([['RiversidePlant', false], ['RiversidePlant/ZoneA', false], ['RiversidePlant/ZoneA/LineA', false]],
            array_map(fn ($e) => [$e['path'], $e['in_scope']], $this->asApplication($list, '/entities')->assertOk()->json('data')));

        // Without entities:read the hierarchy is not served.
        $this->asApplication($this->token($this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]], ['devices:read'])), '/entities')->assertForbidden();
    }

    public function test_entities_pages_by_cursor(): void
    {
        foreach (range(1, 104) as $n) {
            DB::table('entities')->insert(['uuid' => (string) Str::uuid(), 'organization_id' => $this->organization->id, 'entity_type_id' => DB::table('entities')->where('uuid', $this->plant['lineB']['uuid'])->value('entity_type_id'),
                'parent_id' => null, 'name' => 'L'.$n, 'path_name' => sprintf('L%03d', $n), 'path' => sprintf('L%03d', $n), 'depth' => 0, 'created_at' => now(), 'updated_at' => now()]);
            $id = DB::table('entities')->where('path', sprintf('L%03d', $n))->value('id');
            DB::table('entity_closure')->insert(['ancestor_id' => $id, 'descendant_id' => $id, 'depth' => 0]);
        }
        $all = DB::table('entities')->where('organization_id', $this->organization->id)->whereNull('archived_at')->where('path', 'like', 'L%')->pluck('uuid')->all();
        $token = $this->token($this->application(['entity_uuids' => array_slice($all, 0, 50)]));
        DB::table('integration_applications')->update(['entity_uuids' => json_encode($all)]);

        $first = $this->asApplication($token, '/entities')->assertOk()->json();
        $this->assertCount(100, $first['data']);
        $second = $this->asApplication($token, '/entities?cursor='.$first['next_cursor'])->assertOk()->json();
        $this->assertSame(['L101', 'L102', 'L103', 'L104'], array_column($second['data'], 'path'));
        $this->assertNull($second['next_cursor']);
        $this->asApplication($token, '/entities?cursor=nonsense')->assertUnprocessable();
    }

    public function test_the_device_read_shows_its_place_and_points_with_entities_read(): void
    {
        $meter = $this->device('meter', null);
        $parameter = (string) Str::uuid();
        $definition = ['parameters' => [['uuid' => $parameter, 'key' => 'energy', 'label' => 'Energy', 'unit' => 'kWh', 'data_type' => 'float'], ['uuid' => (string) Str::uuid(), 'key' => 'power', 'label' => 'Power', 'unit' => 'kW', 'data_type' => 'float']]];
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => 'meter-profile', 'name' => 'Meter']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now()]);
        $configuration = DeviceConfiguration::create(['device_id' => $meter->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1,
            'definition_hash' => str_repeat('b', 64), 'definition' => ['profile_canonical_json' => json_encode($definition)], 'created_at' => now()]);
        $meter->forceFill(['last_applied_configuration_uuid' => $configuration->uuid])->save();
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/placement', ['entity_uuid' => $this->plant['zoneB']['uuid']])->assertOk();
        $this->putJson($this->prefix.'/devices/'.$meter->uuid.'/parameters/'.$parameter.'/placement', ['entity_uuid' => $this->plant['lineB']['uuid'], 'leaf_name' => 'Ch3Energy'])->assertOk();

        $application = $this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]]);
        $data = $this->asApplication($this->token($application), '/devices/'.$meter->uuid)->assertOk()->json('data');
        $this->assertSame(['uuid' => $this->plant['zoneB']['uuid'], 'path' => 'RiversidePlant/ZoneB'], $data['entity']);
        $this->assertSame([
            ['parameter_uuid' => $parameter, 'leaf_name' => 'Ch3Energy', 'path' => 'RiversidePlant/ZoneB/LineB/Ch3Energy'],
            ['parameter_uuid' => $definition['parameters'][1]['uuid'], 'leaf_name' => 'power', 'path' => 'RiversidePlant/ZoneB/power'],
        ], $data['points']);

        // Without entities:read the read is as it was.
        $plain = $this->application(['entity_uuids' => [$this->plant['zoneB']['uuid']]], ['devices:read']);
        $this->assertArrayNotHasKey('points', $this->asApplication($this->token($plain), '/devices/'.$meter->uuid)->assertOk()->json('data'));
    }
}
