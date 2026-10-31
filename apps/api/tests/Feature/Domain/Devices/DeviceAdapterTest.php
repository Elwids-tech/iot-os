<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\DeviceAdapters\Jobs\DeployAdapter;
use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\AdapterOperation;
use App\Domain\DeviceAdapters\Models\AdapterProposal;
use App\Domain\DeviceAdapters\Models\AdapterRevision;
use App\Domain\DeviceAdapters\Models\AdapterTenant;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\DeviceInstallation;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DeviceAdapterTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $prefix;

    private string $artifact;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        Artisan::call('devices:prepare-water-meter-profile');
        $this->artifact = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        config(['devices.runtime_token' => str_repeat('r', 64), 'devices.broker_admin_token' => 'test-token', 'adapters.enabled' => true, 'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64)]);
        Http::fake(function ($request) {
            if (str_ends_with($request->url(), '/test')) {
                return Http::response(['valid' => true, 'results' => [['passed' => true, 'output' => ['sourceDeviceId' => 'WM-1042', 'metrics' => [['name' => 'flow_rate', 'value' => 12], ['name' => 'total_volume', 'value' => 8400]]]]]]);
            }
            if (str_ends_with($request->url(), '/deploy')) {
                return Http::response(['applied' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']);
            }

            return Http::response(['connected' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']);
        });
        Queue::fake();
    }

    private function input(): array
    {
        return ['request_uuid' => (string) Str::uuid(), 'name' => 'Manufacturer water meter', 'artifact_uuid' => $this->artifact, 'source' => ['type' => 'platform', 'topics' => ['manufacturer/meters/+']], 'code' => 'function decode(input){return {sourceDeviceId:input.payload.serial,metrics:[{name:"flow_rate",value:input.payload.flow_ml_min/1000},{name:"total_volume",value:input.payload.total_ml/1000}]}}', 'fixtures' => [['topic' => 'manufacturer/meters/live', 'payload' => ['serial' => 'WM-1042', 'flow_ml_min' => 12000, 'total_ml' => 8400000]]]];
    }

    private function create(?array $input = null): array
    {
        return $this->postJson($this->prefix.'/device-adapters', $input ?? $this->input())->assertCreated()->json('data');
    }

    private function tested(): array
    {
        $a = $this->create();
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/test', ['draft_revision' => 1])->assertOk()->assertJsonPath('data.valid', true);

        return $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'])->assertOk()->json('data');
    }

    public function test_create_is_idempotent_and_changed_requests_are_rejected(): void
    {
        $input = $this->input();
        $first = $this->create($input);
        $again = $this->create($input);
        $this->assertSame($first['uuid'], $again['uuid']);
        $this->assertSame(1, DeviceAdapter::count());
        $this->postJson($this->prefix.'/device-adapters', [...$input, 'name' => 'Different'])->assertConflict();
    }

    public function test_secrets_are_encrypted_and_excluded_from_views_and_revisions(): void
    {
        $input = $this->input();
        $input['source'] = ['type' => 'vendor', 'url' => 'mqtts://vendor.example.test:8883', 'topics' => ['meter/+']];
        $input['secrets'] = ['username' => 'vendor-customer', 'password' => 'vendor-password-secret'];
        $a = $this->create($input);
        $this->assertStringNotContainsString('vendor-password-secret', json_encode($a));
        $this->assertStringNotContainsString('vendor-password-secret', DB::table('device_adapters')->value('secrets'));
        $this->assertStringNotContainsString('vendor-password-secret', json_encode(AdapterRevision::first()->toArray()));
        $this->getJson($this->prefix.'/device-adapters')->assertOk()->assertJsonPath('data.0.name', $a['name']);
    }

    public function test_edits_invalidate_tests_and_stale_edits_cannot_overwrite(): void
    {
        $a = $this->tested();
        $input = $this->input();
        unset($input['request_uuid']);
        $url = $this->prefix.'/device-adapters/'.$a['uuid'];
        $this->putJson($url, [...$input, 'draft_revision' => 1])->assertOk()->assertJsonPath('data.draft_revision', 2)->assertJsonPath('data.revision.test_result', null);
        $this->putJson($url, [...$input, 'draft_revision' => 1])->assertConflict();
        $this->postJson($url.'/deploy', ['draft_revision' => 2, 'request_uuid' => (string) Str::uuid()])->assertUnprocessable();
    }

    public function test_deployment_is_queued_idempotent_and_only_completed_after_runtime_ack(): void
    {
        $a = $this->tested();
        $url = $this->prefix.'/device-adapters/'.$a['uuid'].'/deploy';
        $body = ['request_uuid' => (string) Str::uuid(), 'draft_revision' => 1];
        $operation = $this->postJson($url, $body)->assertAccepted()->json('data');
        $again = $this->postJson($url, $body)->assertAccepted()->json('data');
        $this->assertSame($operation['uuid'], $again['uuid']);
        $this->assertSame('pending', DeviceAdapter::first()->status);
        $this->assertSame(1, AdapterOperation::count());
        Queue::assertPushed(DeployAdapter::class);
        (new DeployAdapter(AdapterOperation::first()->id))->handle();
        $this->assertSame('running', DeviceAdapter::first()->status);
        $this->assertSame('applied', AdapterOperation::first()->status);
        $this->assertNotEmpty(AdapterTenant::first()->runtime_token);
        $this->assertSame('mqtts://localhost:19000', AdapterTenant::first()->broker_url);
    }

    public function test_failed_deployment_preserves_the_saved_revision(): void
    {
        $a = $this->tested();
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/deploy', ['request_uuid' => (string) Str::uuid(), 'draft_revision' => 1])->assertAccepted();
        Http::swap(new Factory);
        Http::fake(['*' => Http::response([], 503)]);
        (new DeployAdapter(AdapterOperation::first()->id))->handle();
        $this->assertSame('failed', AdapterOperation::first()->status);
        $this->assertSame($a['code'], DeviceAdapter::first()->code);
        $this->assertSame(1, AdapterRevision::count());
    }

    public function test_cross_tenant_access_and_forged_callbacks_are_rejected(): void
    {
        $a = $this->create();
        $other = Organization::create(['name' => 'Other', 'slug' => 'other', 'uuid' => (string) Str::uuid()]);
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/device-adapters/'.$a['uuid'])->assertNotFound();
        $tenant = app(AdapterService::class)->tenant($this->organization);
        $this->withHeaders(['X-Adapter-Tenant' => $tenant->uuid, 'Authorization' => 'Bearer wrong'])->postJson('/api/internal/adapters/events', ['adapter_uuid' => $a['uuid'], 'kind' => 'health', 'source_connected' => true])->assertUnauthorized();
    }

    public function test_discovery_is_preview_only_and_activation_requires_a_live_birth(): void
    {
        $a = $this->tested();
        $adapter = DeviceAdapter::first();
        $adapter->update(['status' => 'running', 'applied_revision_uuid' => $adapter->revisions()->first()->uuid]);
        $tenant = app(AdapterService::class)->tenant($this->organization);
        $this->withHeaders(['X-Adapter-Tenant' => $tenant->uuid, 'Authorization' => 'Bearer '.$tenant->runtime_token])->postJson('/api/internal/adapters/events', ['adapter_uuid' => $a['uuid'], 'revision_uuid' => $adapter->applied_revision_uuid, 'kind' => 'sample', 'source_device_id' => 'WM-1042', 'sparkplug_device_id' => 'src-'.substr(hash('sha256', 'WM-1042'), 0, 32), 'preview' => ['sourceDeviceId' => 'WM-1042', 'metrics' => [['name' => 'flow_rate', 'value' => 12]]], 'retained' => true])->assertNoContent();
        $this->assertSame(1, AdapterCandidate::count());
        $this->assertSame(0, DeviceInstallation::count());
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/candidates/'.AdapterCandidate::first()->uuid.'/activate', ['name' => 'Meter'])->assertUnprocessable();
    }

    public function test_reserved_and_unscoped_topics_are_rejected(): void
    {
        foreach (['#', '+/meters', '$CONTROL/dynamic-security/v1', 'spBv1.0/tenant/#', 'foo/bar#'] as $topic) {
            $v = $this->input();
            $v['source']['topics'] = [$topic];
            $this->postJson($this->prefix.'/device-adapters', $v)->assertUnprocessable();
        }
    }

    private function liveCandidate(): array
    {
        $a = $this->tested();
        $adapter = DeviceAdapter::first();
        $gateway = app(AdapterService::class)->gateway($adapter);
        $adapter->update(['status' => 'running', 'applied_revision_uuid' => $adapter->revisions()->first()->uuid]);
        $source = 'src-'.substr(hash('sha256', 'WM-1042'), 0, 32);
        DiscoveryCandidate::create(['organization_id' => $this->organization->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => $source, 'birth_revision' => 1, 'metrics' => [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 12], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 8400]]]);
        $candidate = AdapterCandidate::create(['organization_id' => $this->organization->id, 'device_adapter_id' => $adapter->id, 'source_device_id' => 'WM-1042', 'sparkplug_device_id' => $source, 'preview' => [], 'last_seen_at' => now()]);

        return [$a, $adapter, $candidate];
    }

    public function test_activation_is_atomic_idempotent_and_pins_the_installation_to_the_virtual_device(): void
    {
        [$a,$adapter,$candidate] = $this->liveCandidate();
        $url = $this->prefix.'/device-adapters/'.$a['uuid'].'/candidates/'.$candidate->uuid.'/activate';
        $result = $this->postJson($url, ['name' => 'Workshop water meter'])->assertAccepted()->json('data');
        $this->postJson($url, ['name' => 'Workshop water meter'])->assertAccepted()->assertJsonPath('data.installation_uuid', $result['installation_uuid']);
        $this->assertSame(1, DeviceInstallation::count());
        $device = Device::where('uuid', $result['device']['uuid'])->firstOrFail();
        $configuration = $device->configurations()->firstOrFail()->definition;
        $this->assertSame($result['installation_uuid'], $configuration['adapter']['installation_uuid']);
        $this->assertSame('WM-1042', $configuration['adapter']['manufacturer_serial']);
        $this->assertSame('none', $configuration['mappings'][0]['conversion_mode']);
        $this->assertSame('pending', $adapter->fresh()->status);
        Queue::assertPushed(DeployAdapter::class);
    }

    public function test_adapter_sources_go_by_serial_and_only_activate_through_the_adapter(): void
    {
        [$a, $adapter, $candidate] = $this->liveCandidate();
        DiscoveryCandidate::create(['organization_id' => $this->organization->id, 'sparkplug_gateway_id' => $adapter->sparkplug_gateway_id, 'source_device_id' => '', 'birth_revision' => 1, 'metrics' => []]);
        // The adapter's own node is not a device, and its sources are found by serial.
        $sources = $this->getJson($this->prefix.'/discovery-candidates?search=wm-1042')->assertOk()->json('data');
        $this->assertCount(1, $sources);
        $this->assertSame(['uuid' => $a['uuid'], 'name' => 'Manufacturer water meter', 'candidate_uuid' => $candidate->uuid, 'serial' => 'WM-1042'], $sources[0]['adapter']);
        $this->assertNotContains('', array_column($this->getJson($this->prefix.'/discovery-candidates')->json('data'), 'source_device_id'));
        // Mapping it by hand would lose the adapter installation, so only activation uses it.
        $device = $this->postJson($this->prefix.'/devices', ['name' => 'Hand mapped', 'code' => 'hand-mapped'])->assertCreated()->json('data');
        $this->putJson($this->prefix.'/devices/'.$device['uuid'].'/configuration', ['draft_revision' => $device['draft_revision'], 'artifact_uuid' => $this->artifact, 'candidate_uuid' => $sources[0]['uuid'], 'birth_revision' => 1, 'mappings' => []])
            ->assertUnprocessable()->assertJsonPath('message', 'This source comes through the adapter "Manufacturer water meter". Activate it from the adapter, which sets the device up in one step.');
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/candidates/'.$candidate->uuid.'/activate', ['name' => 'WM-1042'])->assertAccepted();
        $this->getJson($this->prefix.'/discovery-candidates/'.$sources[0]['uuid'])->assertOk()->assertJsonPath('data.adapter.serial', 'WM-1042');
    }

    public function test_an_unused_adapter_is_deleted_with_its_runtime_and_gateway(): void
    {
        [$a, $adapter] = $this->liveCandidate();
        app(AdapterService::class)->tenant($this->organization);
        $gateway = $adapter->fresh()->gateway;
        $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'])->assertOk()->assertJsonPath('data.deletion', ['allowed' => true, 'reason' => null]);
        $this->getJson($this->prefix.'/device-adapters')->assertOk()->assertJsonPath('data.0.deletable', true);
        $this->deleteJson($this->prefix.'/device-adapters/'.$a['uuid'])->assertNoContent();
        $this->assertSame(0, DeviceAdapter::count());
        $this->assertSame(0, AdapterCandidate::count());
        $this->assertSame(0, AdapterRevision::count());
        $this->assertNull($gateway->fresh());
        $this->assertSame(0, DiscoveryCandidate::where('sparkplug_gateway_id', $gateway->id)->count());
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/remove') && $r['adapter_uuid'] === $a['uuid'] && $r['usernames'] === []);
        // The gateway's platform identity gets a password nobody keeps.
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/clients') && $r['username'] === $gateway->username && $r['password'] !== $gateway->password);
        $this->assertTrue(DB::table('activity_log')->where('event', 'device.adapter.deleted')->where('subject_uuid', $a['uuid'])->exists());
        // A death the publisher sent while it stopped does not bring the gateway back.
        $this->withToken(str_repeat('r', 64))->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'gateway.presence.v1',
            'payload' => ['connection_uuid' => $gateway->connection->uuid, 'edge_node_id' => $gateway->edge_node_id, 'presence' => 'offline', 'session_id' => 's-1', 'last_seen_at' => now()->toIso8601String()]])->assertOk();
        $this->assertFalse(DB::table('sparkplug_gateways')->where('edge_node_id', $gateway->edge_node_id)->exists());
    }

    public function test_an_adapter_with_an_activated_device_cannot_be_deleted(): void
    {
        [$a, , $candidate] = $this->liveCandidate();
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/candidates/'.$candidate->uuid.'/activate', ['name' => 'Workshop water meter'])->assertAccepted();
        DeviceAdapter::first()->update(['status' => 'running']);
        $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'])->assertOk()
            ->assertJsonPath('data.deletion', ['allowed' => false, 'reason' => 'A device was activated through this adapter.']);
        $this->getJson($this->prefix.'/device-adapters')->assertOk()->assertJsonPath('data.0.deletable', false);
        $this->deleteJson($this->prefix.'/device-adapters/'.$a['uuid'])->assertConflict()
            ->assertJsonPath('message', 'A device was activated through this adapter. Adapters in use cannot be deleted.');
        $this->assertSame(1, DeviceAdapter::count());
        Http::assertNotSent(fn ($r) => str_ends_with($r->url(), '/remove'));
    }

    public function test_binding_failure_rolls_back_native_activation_and_installation(): void
    {
        [$a,$adapter,$candidate] = $this->liveCandidate();
        $adapter->revisions()->first()->update(['tested_at' => null]);
        $before = Device::count();
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/candidates/'.$candidate->uuid.'/activate', ['name' => 'Rollback meter'])->assertUnprocessable();
        $this->assertSame($before, Device::count());
        $this->assertSame(0, DeviceInstallation::count());
        $this->assertSame(0, AdapterOperation::count());
    }

    public function test_broker_secrets_cannot_be_embedded_in_the_visible_source_url(): void
    {
        $input = $this->input();
        $input['source'] = ['type' => 'vendor', 'url' => 'mqtts://user:secret@vendor.example:8883', 'topics' => ['meters/+']];
        $this->postJson($this->prefix.'/device-adapters', $input)->assertUnprocessable();
        $this->assertSame(0, DeviceAdapter::count());
    }

    public function test_hardware_kits_are_private_zips_with_rotation_and_revocation(): void
    {
        $a = $this->create();
        $url = $this->prefix.'/device-adapters/'.$a['uuid'].'/credentials';
        $kit = $this->postJson($url, ['name' => 'WM-1042'])->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('data');
        $this->assertStringEndsWith('.zip', $kit['filename']);
        $this->assertStringStartsWith('PK', base64_decode($kit['archive_base64']));
        $this->assertSame(['manufacturer/meters/+'], $kit['publish_topics']);
        $list = $this->getJson($url)->assertOk()->getContent();
        $this->assertStringNotContainsString($kit['password'], $list);
        $rotated = $this->postJson($url.'/'.$kit['credential_uuid'].'/rotate')->assertOk()->json('data');
        $this->assertNotSame($kit['password'], $rotated['password']);
        $this->postJson($url.'/'.$kit['credential_uuid'].'/revoke')->assertOk()->assertJsonPath('data.revoked', true);
        $this->postJson($url.'/'.$kit['credential_uuid'].'/kit')->assertNotFound();
    }

    public function test_ai_proposal_requires_matching_hash_and_revision_and_never_deploys(): void
    {
        $a = $this->tested();
        $adapter = DeviceAdapter::first();
        $proposal = AdapterProposal::create(['device_adapter_id' => $adapter->id, 'conversation_id' => (string) Str::uuid(), 'user_id' => auth()->id(), 'draft_revision' => 1, 'code' => 'function decode(input){return {sourceDeviceId:input.payload.serial,metrics:[]}}', 'summary' => 'Inspect this decoder', 'evidence' => [['origin' => 'suggested']], 'content_hash' => str_repeat('a', 64)]);
        $url = $this->prefix.'/device-adapters/'.$a['uuid'].'/proposals/'.$proposal->uuid.'/decision';
        $this->postJson($url, ['action' => 'apply', 'content_hash' => str_repeat('b', 64)])->assertConflict();
        $this->postJson($url, ['action' => 'apply', 'content_hash' => str_repeat('a', 64)])->assertOk()->assertJsonPath('data.draft_revision', 2)->assertJsonPath('data.revision.test_result', null);
        $this->assertSame(0, AdapterOperation::count());
    }

    public function test_adapter_assistant_is_bound_to_the_authorized_adapter(): void
    {
        $a = $this->create();
        $conversation = $this->postJson($this->prefix.'/assistant/conversations', ['scope' => 'adapter', 'adapter_uuid' => $a['uuid']])->assertCreated()->json('data');
        // Spec 020: the adapter assistant became the device onboarding assistant.
        $this->assertSame('onboarding', $conversation['scope']);
        $this->assertSame($a['uuid'], $conversation['adapter_uuid']);
        $this->postJson($this->prefix.'/assistant/conversations', ['scope' => 'adapter', 'adapter_uuid' => (string) Str::uuid()])->assertNotFound();
    }
}
