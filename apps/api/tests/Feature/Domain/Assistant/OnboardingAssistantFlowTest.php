<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Assistant;

use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Models\AssistantRun;
use App\Domain\Assistant\Tools\OnboardingTools;
use App\Domain\Assistant\Tools\ProfileAssistantTools;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Ai\Tools\Request;
use Tests\TestCase;

/** The onboarding assistant carries a device from description to a tested decoder (UX walkthrough of 2026-10-31). */
final class OnboardingAssistantFlowTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $prefix;

    private string $waterMeter;

    private string $environmentSensor;

    /** @var list<array{path: string, body: array}> */
    private array $manager = [];

    private array $sample = ['topic' => 'meters/WM-2001/telemetry', 'payload' => ['device_id' => 'WM-2001', 'flow_l_min' => 12, 'total_l' => 53]];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        Artisan::call('devices:prepare-water-meter-profile');
        Artisan::call('devices:prepare-environment-sensor-profile');
        $this->waterMeter = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $this->environmentSensor = DeviceProfile::where('code', 'vendor-environment-sensor-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        config(['devices.runtime_token' => str_repeat('r', 64), 'devices.broker_admin_token' => 'test-token', 'adapters.enabled' => true, 'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64),
            'adapters.webhook_public_url' => 'https://hooks.example.com', 'adapters.receiver_token' => str_repeat('w', 48), 'adapters.allow_private_endpoints' => false]);
        Http::fake(function (ClientRequest $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            $this->manager[] = ['path' => $path, 'body' => $request->data()];

            return match ($path) {
                '/test' => Http::response(['valid' => true, 'results' => [['passed' => true, 'output' => ['sourceDeviceId' => 'WM-2001', 'metrics' => [['name' => 'flow_rate', 'value' => 12]]]]]]),
                default => Http::response(['connected' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']),
            };
        });
        Queue::fake();
    }

    private function conversation(): AssistantConversation
    {
        return AssistantConversation::findOrFail($this->postJson($this->prefix.'/assistant/conversations', ['scope' => 'onboarding'])->assertCreated()->json('data.id'));
    }

    private function startRun(AssistantConversation $conversation): AssistantRun
    {
        return $conversation->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
    }

    /** Calls one onboarding action as the model does, with JSON arguments. */
    private function act(AssistantRun $run, string $action, array $args = [], string $tool = OnboardingTools::class): array
    {
        return json_decode((string) (new $tool($run))->handle(new Request(['action' => $action, 'arguments_json' => json_encode($args)])), true);
    }

    private function adapter(array $source, string $artifact, string $name = 'Meters'): DeviceAdapter
    {
        $uuid = $this->postJson($this->prefix.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => $name, 'artifact_uuid' => $artifact, 'source' => $source, 'code' => 'function decode(input){return {sourceDeviceId:"x",metrics:[]}}', 'fixtures' => []])->assertCreated()->json('data.uuid');

        return DeviceAdapter::where('uuid', $uuid)->firstOrFail();
    }

    private function apply(AssistantConversation $conversation, array $proposal)
    {
        return $this->postJson($this->prefix.'/assistant/conversations/'.$conversation->id.'/adapter-proposals/'.$proposal['uuid'].'/decision', ['action' => 'apply', 'content_hash' => $proposal['content_hash'], 'request_id' => (string) Str::uuid()]);
    }

    private function pollSource(string $account): array
    {
        return ['type' => 'poll', 'request' => ['method' => 'GET', 'url' => "https://api.example.com/accounts/{$account}/history", 'query' => [['name' => 'start', 'value' => '{cursor}']], 'headers' => []],
            'credentials' => ['placement' => 'header', 'name' => 'x-api-key'], 'page' => ['size' => 500, 'size_param' => 'limit', 'more' => 'full_page'], 'records' => '/data', 'cursor' => ['kind' => 'timestamp', 'pointer' => '/maxDate']];
    }

    public function test_decoder_tests_use_pasted_samples_and_the_next_proposal_keeps_them(): void
    {
        $conversation = $this->conversation();
        $run = $this->startRun($conversation);
        $code = 'function decode(input){const p=input.payload;return {sourceDeviceId:p.device_id,metrics:[{name:"flow_rate",value:p.flow_l_min}]}}';

        $this->assertStringContainsString('artifact_uuid', $this->act($run, 'test_decoder', ['code' => $code, 'fixtures' => [$this->sample]])['reason']);
        // Before an adapter exists, the pasted sample is tested against the chosen profile.
        $tested = $this->act($run, 'test_decoder', ['code' => $code, 'fixtures' => [$this->sample], 'artifact_uuid' => $this->waterMeter]);
        $this->assertTrue($tested['valid']);
        $this->assertSame([$this->sample], end($this->manager)['body']['fixtures']);
        $this->assertArrayHasKey('parameters', end($this->manager)['body']['profile']);
        // Samples given as inputs, as models often do, are tested the same way.
        $this->assertTrue($this->act($run, 'test_decoder', ['code' => $code, 'inputs' => [$this->sample], 'artifact_uuid' => $this->waterMeter])['valid']);
        $this->assertArrayHasKey('error', $this->act($run, 'test_decoder', ['code' => $code, 'fixtures' => [['topic' => 'meters/WM-2001/telemetry']], 'artifact_uuid' => $this->waterMeter]));

        $proposal = $this->act($run, 'propose_adapter', ['mode' => 'create', 'name' => 'WM-200 water meters', 'artifact_uuid' => $this->waterMeter, 'source' => ['type' => 'platform', 'topics' => ['meters/+/telemetry']], 'code' => $code, 'summary' => 'New meters']);
        $this->assertSame([$this->sample], $proposal['fixtures']);
        $run->update(['status' => 'completed']);
        $this->apply($conversation, $proposal)->assertOk();
        $adapter = $conversation->fresh()->adapter;
        $this->assertSame([$this->sample], $adapter->fixtures);

        $run = $this->startRun($conversation);
        $second = ['topic' => 'meters/WM-2002/telemetry', 'payload' => ['device_id' => 'WM-2002', 'flow_l_min' => 3, 'total_l' => 9]];
        $this->assertTrue($this->act($run, 'test_decoder', ['code' => $code, 'fixtures' => [$this->sample, $second]])['valid']);
        $change = $this->act($run, 'propose_change', ['summary' => 'Read the flow rate', 'code' => $code]);
        // Only the sample the adapter does not keep yet is added.
        $this->assertSame([$second], $change['fixtures']);
        $this->assertNull($this->act($run, 'propose_change', ['summary' => 'Poll less often', 'source' => ['type' => 'platform', 'topics' => ['meters/+/telemetry']]])['fixtures']);
    }

    public function test_an_adapter_is_reused_only_for_the_same_profile_and_source(): void
    {
        $sensors = $this->adapter(['type' => 'platform', 'topics' => ['sensors/+/env']], $this->environmentSensor, 'Room sensors');
        $meters = $this->adapter(['type' => 'platform', 'topics' => ['meters/+/telemetry']], $this->waterMeter);
        $conversation = $this->conversation();
        $run = $this->startRun($conversation);
        $reuse = fn (DeviceAdapter $adapter, array $source, ?string $artifact = null) => $this->act($run, 'propose_adapter', ['mode' => 'reuse', 'adapter_uuid' => $adapter->uuid, 'artifact_uuid' => $artifact ?? $this->waterMeter, 'source' => $source, 'summary' => 'Reuse']);

        $found = collect($this->act($run, 'find', ['kind' => 'adapters'])['adapters'])->keyBy('uuid');
        $this->assertSame(['topics' => ['meters/+/telemetry']], $found[$meters->uuid]['source']);
        $this->assertSame($meters->artifact->profile->uuid, $found[$meters->uuid]['profile_uuid']);
        // The environmental-sensor adapter is not offered for water meters, whatever the transport.
        $wrongProfile = $reuse($sensors, ['type' => 'platform', 'topics' => ['sensors/+/env']]);
        $this->assertStringContainsString('Environmental sensor (vendor JSON)', $wrongProfile['reason']);
        $this->assertStringContainsString('mode create', $wrongProfile['reason']);
        $this->assertArrayHasKey('error', $reuse($meters, ['type' => 'platform', 'topics' => ['plant2/meters/+']]));
        $this->assertArrayHasKey('error', $reuse($meters, ['type' => 'platform', 'topics' => ['meters/#']]));
        $this->assertArrayHasKey('error', $reuse($meters, ['type' => 'vendor', 'url' => 'mqtts://broker.example.com:8883', 'topics' => ['meters/+/telemetry']]));
        $this->assertSame('reuse', $reuse($meters, ['type' => 'platform', 'topics' => ['meters/WM-2001/telemetry']])['kind']);

        $trackers = $this->adapter($this->pollSource('A1'), $this->waterMeter, 'Trackers');
        $this->assertStringContainsString('/accounts/A1/history', $reuse($trackers, $this->pollSource('A2'))['reason']);
        $this->assertSame('reuse', $reuse($trackers, $this->pollSource('A1'))['kind']);
    }

    public function test_a_live_adapter_is_never_repointed_at_another_account(): void
    {
        $trackers = $this->adapter($this->pollSource('A1'), $this->waterMeter, 'Trackers');
        $trackers->update(['applied_revision_uuid' => (string) Str::uuid(), 'status' => 'running']);
        $conversation = $this->conversation();
        $conversation->update(['device_adapter_id' => $trackers->id]);
        $run = $this->startRun($conversation);

        $repoint = $this->act($run, 'propose_change', ['summary' => 'Use the new account', 'source' => $this->pollSource('A2')]);
        $this->assertStringContainsString('mode create', $repoint['reason']);
        // Settings that keep the same endpoint and account can still change.
        $this->assertSame('change', $this->act($run, 'propose_change', ['summary' => 'Records are under /items', 'source' => [...$this->pollSource('A1'), 'records' => '/items']])['kind']);
    }

    public function test_a_profile_is_drafted_from_what_the_person_said_in_chat(): void
    {
        $conversation = $this->conversation();
        $run = $this->startRun($conversation);

        $facts = $this->act($run, 'record_facts', ['facts' => [['field' => 'flow_rate.unit', 'value' => 'L/min', 'certainty' => 'explicit']]], ProfileAssistantTools::class);
        $this->assertSame(['recorded' => 1], $facts);
        $this->assertSame('user_stated', $conversation->fresh()->onboarding_state['source_facts'][0]['origin']);
        $preview = $this->act($run, 'preview_section', ['section' => 'identity', 'summary' => 'Create the WM-200 water meter profile',
            'changes' => [['operation' => 'upsert', 'uuid' => null, 'values' => ['name' => 'WM-200 water meter', 'code' => 'wm-200-water-meter']]],
            'evidence' => [['field' => 'name', 'origin' => 'user_stated', 'note' => 'The person named the model'], ['field' => 'code', 'origin' => 'chat'], 'Suggested from the name']], ProfileAssistantTools::class);
        $this->assertArrayNotHasKey('error', $preview, json_encode($preview));
        $proposal = $conversation->proposals()->findOrFail($preview['id']);
        $this->assertSame(['user_stated', 'user_stated', 'suggested'], array_column($proposal->evidence, 'origin'));
        $this->assertFalse(collect($proposal->diagnostics)->contains(fn ($d) => $d['blocking'] ?? false));

        $run->update(['status' => 'completed']);
        $this->postJson($this->prefix.'/assistant/conversations/'.$conversation->id.'/proposals/'.$proposal->id.'/decision', ['decision' => 'approve', 'content_hash' => $proposal->content_hash, 'request_id' => (string) Str::uuid()])->assertOk();
        $this->assertSame('WM-200 water meter', $conversation->fresh()->profile->name);
    }
}
