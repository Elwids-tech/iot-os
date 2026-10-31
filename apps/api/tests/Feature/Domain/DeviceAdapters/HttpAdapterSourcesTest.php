<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceAdapters;

use App\Domain\Assistant\Agents\OnboardingAssistant;
use App\Domain\Assistant\Models\AssistantConversation;
use App\Domain\Assistant\Tools\OnboardingTools;
use App\Domain\DeviceAdapters\Models\AdapterDelivery;
use App\Domain\DeviceAdapters\Models\AdapterOperation;
use App\Domain\DeviceAdapters\Models\AdapterProposal;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\PollRun;
use App\Domain\DeviceAdapters\Models\WebhookSecret;
use App\Domain\DeviceAdapters\Services\AdapterDiagnostics;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Ai\Tools\Request;
use Tests\TestCase;

/** Spec 020: HTTP webhook and polling adapter sources and the device onboarding assistant. */
final class HttpAdapterSourcesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $prefix;

    private string $artifact;

    /** @var list<array{path: string, body: array}> */
    private array $manager = [];

    private array $fetchResult = ['status' => 200, 'duration_ms' => 42, 'headers' => [], 'excerpt' => '{"data":[{"id":"TRK-1001-1"}],"maxDate":"2026-10-27T09:12:00.000Z"}', 'truncated' => false, 'record_count' => 1, 'records' => [['id' => 'TRK-1001-1', 'deviceId' => 'TRK-1001']], 'next_cursor' => '2026-10-27T09:12:00.000Z', 'more' => false, 'error' => null];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        Artisan::call('devices:prepare-water-meter-profile');
        $this->artifact = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        config(['devices.runtime_token' => str_repeat('r', 64), 'devices.broker_admin_token' => 'test-token', 'adapters.enabled' => true, 'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64),
            'adapters.webhook_public_url' => 'https://hooks.example.com', 'adapters.receiver_token' => str_repeat('w', 48), 'adapters.allow_private_endpoints' => false]);
        Http::fake(function (ClientRequest $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            $this->manager[] = ['path' => $path, 'body' => $request->data()];

            return match ($path) {
                '/test' => Http::response(['valid' => true, 'results' => [['passed' => true, 'output' => ['sourceDeviceId' => 'TRK-1001', 'metrics' => [['name' => 'flow_rate', 'value' => 12]], 'observedAt' => '2026-10-27T09:12:00.000Z']]]]),
                '/deploy' => Http::response(['applied' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']),
                '/poll-test' => Http::response($this->fetchResult),
                '/webhook' => Http::response(['configured' => true]),
                default => Http::response(['connected' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']),
            };
        });
        Queue::fake();
    }

    private function code(): string
    {
        return 'function decode(input){const p=input.payload;return {sourceDeviceId:p.deviceId,metrics:[{name:"flow_rate",value:p.flow}],observedAt:p.timestamp,messageId:p.id}}';
    }

    private function webhook(array $auth = ['mode' => 'hmac', 'signature_header' => 'X-Signature', 'prefix' => 'sha256=']): array
    {
        return $this->postJson($this->prefix.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'Cloud sensors', 'artifact_uuid' => $this->artifact, 'source' => ['type' => 'webhook', 'auth' => $auth], 'code' => $this->code(), 'fixtures' => []])->assertCreated()->json('data');
    }

    private function pollSource(array $change = []): array
    {
        return array_replace_recursive(['type' => 'poll', 'request' => ['method' => 'GET', 'url' => 'https://api.example.com/accounts/A1/streams/history', 'query' => [['name' => 'start', 'value' => '{cursor}'], ['name' => 'end', 'value' => '{now}']], 'headers' => []],
            'credentials' => ['placement' => 'header', 'name' => 'x-api-key'], 'page' => ['size' => 500, 'size_param' => 'limit', 'more' => 'full_page'], 'records' => '/data', 'cursor' => ['kind' => 'timestamp', 'pointer' => '/maxDate']], $change);
    }

    private function poll(array $source = [], array $secrets = ['api_key' => 'vendor-api-key-123456']): array
    {
        return $this->postJson($this->prefix.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'Trackers', 'artifact_uuid' => $this->artifact, 'source' => $source ?: $this->pollSource(), 'secrets' => $secrets, 'code' => $this->code(),
            'fixtures' => [['source' => 'poll', 'payload' => ['id' => 'TRK-1001-1', 'deviceId' => 'TRK-1001', 'flow' => 12, 'timestamp' => '2026-10-27T09:12:00Z']]]])->assertCreated()->json('data');
    }

    private function calls(string $path): array
    {
        return array_values(array_filter($this->manager, fn ($call) => $call['path'] === $path));
    }

    private function runtime(array $event)
    {
        $tenant = app(AdapterService::class)->tenant($this->organization);

        return $this->withHeaders(['X-Adapter-Tenant' => $tenant->uuid, 'Authorization' => 'Bearer '.$tenant->runtime_token])->postJson('/api/internal/adapters/events', $event);
    }

    public function test_webhook_sources_need_an_ingest_address_and_get_an_unguessable_url(): void
    {
        config(['adapters.webhook_public_url' => null]);
        $this->postJson($this->prefix.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'Cloud sensors', 'artifact_uuid' => $this->artifact, 'source' => ['type' => 'webhook', 'auth' => ['mode' => 'hmac', 'signature_header' => 'x-signature']], 'code' => $this->code(), 'fixtures' => []])
            ->assertUnprocessable()->assertJsonPath('message', 'This deployment does not accept webhooks yet. An operator must configure a public ingest address.');
        config(['adapters.webhook_public_url' => 'https://hooks.example.com']);
        $a = $this->webhook();
        $this->assertMatchesRegularExpression('#^https://hooks\.example\.com/w/[A-Za-z0-9]{32}$#', $a['webhook']['ingest_url']);
        $this->assertStringNotContainsString(Str::slug($this->organization->name), $a['webhook']['ingest_url']);
        $this->assertSame(['mode' => 'hmac', 'signature_header' => 'x-signature', 'encoding' => 'hex', 'prefix' => 'sha256=', 'timestamp_header' => null], $a['source']['auth']);
        $this->assertSame('no_deliveries', $a['source_state']['state']);
        $this->assertSame(['type', 'connect', 'samples', 'decoder', 'deploy', 'activate'], array_column($a['checklist'], 'step'));
        $this->assertSame('todo', $a['checklist'][1]['state']);
        // The ingest URL survives new revisions.
        $saved = $this->putJson($this->prefix.'/device-adapters/'.$a['uuid'], [...collect($a)->only(['name', 'artifact_uuid', 'code', 'fixtures', 'source'])->all(), 'draft_revision' => 1])->assertOk()->json('data');
        $this->assertSame($a['webhook']['ingest_url'], $saved['webhook']['ingest_url']);
    }

    public function test_webhook_secrets_are_shown_once_rotated_and_revoked_within_the_request(): void
    {
        $a = $this->webhook();
        $url = $this->prefix.'/device-adapters/'.$a['uuid'].'/webhook/secrets';
        $first = $this->postJson($url, ['label' => 'Vendor console'])->assertCreated()->assertHeader('Cache-Control', 'no-store, private')->json('data');
        $this->assertGreaterThanOrEqual(43, strlen($first['value']));
        $this->assertSame('sampling', end($this->manager)['body']['state']);
        $this->assertSame($first['value'], end($this->manager)['body']['secrets'][0]['value']);
        $show = $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'].'/webhook')->assertOk();
        $this->assertStringNotContainsString($first['value'], $show->getContent());
        $this->assertStringNotContainsString($first['value'], json_encode(DB::table('activity_log')->get()));
        $second = $this->postJson($url, ['label' => 'Rotation', 'value' => 'vendor-issued-signing-secret'])->assertCreated()->json('data');
        $this->assertNull($second['value']);
        $this->assertTrue(WebhookSecret::where('uuid', $first['secret']['uuid'])->first()->expires_at->between(now()->addDays(7)->subMinute(), now()->addDays(7)->addMinute()));
        $this->assertCount(2, end($this->manager)['body']['secrets']);
        $this->postJson($url, ['label' => 'Third'])->assertUnprocessable();
        $this->postJson($url.'/'.$first['secret']['uuid'].'/revoke')->assertOk();
        $this->assertSame(['vendor-issued-signing-secret'], array_column(end($this->manager)['body']['secrets'], 'value'));
        $this->assertSame(['device.adapter.webhook_secret.created', 'device.adapter.webhook_secret.rotated', 'device.adapter.webhook_secret.revoked'], DB::table('activity_log')->where('event', 'like', 'device.adapter.webhook_secret.%')->orderBy('id')->pluck('event')->all());
        $other = $this->webhook();
        $this->postJson($this->prefix.'/device-adapters/'.$other['uuid'].'/webhook/secrets/'.$second['secret']['uuid'].'/revoke')->assertNotFound();
        $this->postJson($url, ['label' => 'Short', 'value' => 'too-short'])->assertUnprocessable();
    }

    public function test_url_token_mode_gives_the_full_url_once_and_vendor_secrets_need_hmac(): void
    {
        $a = $this->webhook(['mode' => 'url']);
        $secret = $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/webhook/secrets', ['label' => 'Vendor console'])->assertCreated()->json('data');
        $this->assertSame($a['webhook']['ingest_url'].'/'.$secret['value'], $secret['ingest_url']);
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/webhook/secrets', ['label' => 'Pasted', 'value' => 'vendor-issued-signing-secret'])->assertUnprocessable();
    }

    public function test_receiver_reports_are_authenticated_and_applied_once(): void
    {
        $a = $this->webhook();
        $secret = $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/webhook/secrets', ['label' => 'Vendor console'])->json('data');
        $report = ['schema_version' => 'receiver-report.v1', 'report_id' => (string) Str::uuid(), 'reports' => [[
            'adapter_uuid' => $a['uuid'], 'outcomes' => ['accepted' => 3, 'unauthenticated' => 1], 'secrets_used' => [$secret['secret']['uuid'] => now()->toIso8601String()],
            'rejections' => [['at' => now()->toIso8601String(), 'reason' => 'unauthenticated', 'address' => '203.0.113.7', 'path' => '', 'size' => 12, 'content_type' => 'application/json']],
            'samples' => [['at' => now()->toIso8601String(), 'delivery_id' => (string) Str::uuid(), 'path' => '/uplink', 'query' => [], 'content_type' => 'application/json', 'headers' => ['x-vendor-event' => 'uplink'], 'size' => 30, 'body_base64' => base64_encode('[{"deviceId":"SNS-2001","flow":1}]')]],
        ]]];
        $this->withHeaders(['Authorization' => 'Bearer wrong'])->postJson('/api/internal/adapters/receiver-reports', $report)->assertUnauthorized();
        $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('w', 48)])->postJson('/api/internal/adapters/receiver-reports', $report)->assertNoContent();
        $this->withHeaders(['Authorization' => 'Bearer '.str_repeat('w', 48)])->postJson('/api/internal/adapters/receiver-reports', $report)->assertNoContent();
        $webhook = $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'].'/webhook')->assertOk()->json('data');
        $this->assertSame(['accepted' => 3, 'unauthenticated' => 1], $webhook['counts']['24h']);
        $this->assertNotNull($webhook['secrets'][0]['last_used_at']);
        $deliveries = $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'].'/deliveries')->assertOk()->json('data');
        $this->assertCount(2, $deliveries);
        $rejected = collect($deliveries)->firstWhere('kind', 'rejected');
        $this->assertNull($rejected['input']);
        $sample = collect($deliveries)->firstWhere('kind', 'sample');
        $this->assertSame('webhook', $sample['input']['source']);
        $this->assertSame('/uplink', $sample['input']['http']['path']);
        $view = $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'])->json('data');
        $this->assertSame('rejecting', $view['source_state']['state']);
        $this->assertSame('done', $view['checklist'][1]['state']);
        $this->assertSame('waiting', $view['checklist'][2]['state']);
    }

    public function test_polling_settings_are_validated_and_credentials_stay_secret(): void
    {
        foreach ([
            ['request' => ['url' => 'https://api.example.com/{cursor}']],
            ['request' => ['query' => [['name' => 'start', 'value' => '{password}']]]],
            ['request' => ['headers' => [['name' => 'Authorization', 'value' => 'Bearer x']]]],
            ['request' => ['url' => 'https://10.0.0.5/history']],
            ['request' => ['url' => 'http://api.example.com/history']],
            ['request' => ['url' => 'https://user:pass@api.example.com/history']],
            ['interval_seconds' => 30],
            ['cursor' => ['kind' => 'window', 'pointer' => null]],
            ['credentials' => ['placement' => 'query', 'name' => null]],
        ] as $change) {
            $this->postJson($this->prefix.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'Trackers', 'artifact_uuid' => $this->artifact, 'source' => $this->pollSource($change), 'code' => $this->code(), 'fixtures' => []])->assertUnprocessable();
        }
        $a = $this->poll();
        $this->assertSame(300, $a['source']['interval_seconds']);
        $this->assertTrue($a['saved_secrets']['api_key']);
        $this->assertSame('not_deployed', $a['polling']['state']);
        $adapter = DeviceAdapter::first();
        $this->assertStringNotContainsString('vendor-api-key-123456', json_encode([$a, $adapter->revisions()->first()->definition, DB::table('device_adapters')->value('secrets')]));
        $this->assertSame('vendor-api-key-123456', $adapter->secrets['api_key']);
        // A blank credential keeps the saved one.
        $this->putJson($this->prefix.'/device-adapters/'.$a['uuid'], [...collect($a)->only(['name', 'artifact_uuid', 'code', 'fixtures', 'source'])->all(), 'secrets' => ['api_key' => ''], 'draft_revision' => 1])->assertOk();
        $this->assertSame('vendor-api-key-123456', $adapter->fresh()->secrets['api_key']);
    }

    public function test_fetch_now_is_limited_redacted_and_never_moves_the_cursor(): void
    {
        $a = $this->poll();
        $url = $this->prefix.'/device-adapters/'.$a['uuid'].'/fetch-now';
        $result = $this->postJson($url, ['draft_revision' => 1])->assertOk()->json('data');
        $this->assertSame('2026-10-27T09:12:00.000Z', $result['next_cursor']);
        $call = $this->calls('/poll-test')[0]['body'];
        $this->assertSame('vendor-api-key-123456', $call['source']['api_key']);
        $this->assertNotNull($call['cursor']);
        $this->assertNull(DeviceAdapter::first()->poll_state);
        $view = $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'])->json('data');
        $this->assertSame('done', $view['checklist'][1]['state']);
        $this->postJson($url, ['draft_revision' => 2])->assertConflict();
        for ($i = 0; $i < 5; $i++) {
            $this->postJson($url, ['draft_revision' => 1])->assertOk();
        }
        $this->postJson($url, ['draft_revision' => 1])->assertStatus(429);
    }

    public function test_first_deploy_starts_the_cursor_and_runs_reset_and_resume_it(): void
    {
        $a = $this->poll();
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/test', ['draft_revision' => 1])->assertOk();
        $start = now()->subHours(2)->startOfMinute();
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/deploy', ['request_uuid' => (string) Str::uuid(), 'draft_revision' => 1, 'cursor_start_at' => $start->toIso8601String()])->assertAccepted();
        app(AdapterService::class)->deploy(AdapterOperation::firstOrFail());
        $deploy = $this->calls('/deploy')[0]['body'];
        $this->assertSame(1, $deploy['cursor']['generation']);
        $this->assertSame($start->toIso8601String(), $deploy['cursor']['start_at']);
        $this->assertSame('vendor-api-key-123456', $deploy['source']['api_key']);
        $this->assertSame([], $deploy['hardware_credentials']);
        $adapter = DeviceAdapter::first();
        $run = ['adapter_uuid' => $a['uuid'], 'revision_uuid' => $adapter->applied_revision_uuid, 'kind' => 'poll_run', 'run_id' => (string) Str::uuid(), 'started_at' => now()->toIso8601String(), 'finished_at' => now()->toIso8601String(),
            'outcome' => 'stopped', 'http_status' => 401, 'pages' => 0, 'records' => 0, 'published' => 0, 'failed' => 0, 'duplicates' => 0, 'cursor_before' => 'c1', 'cursor_after' => 'c1', 'committed_at' => null, 'error' => 'Credentials rejected', 'state' => 'stopped', 'reason' => 'Credentials rejected'];
        $this->runtime($run)->assertNoContent();
        $this->runtime($run)->assertNoContent();
        $this->assertSame(1, PollRun::count());
        $view = $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'])->json('data');
        $this->assertSame('Stopped: credentials rejected', $view['source_state']['label']);
        $this->assertSame(['attention', 'Polling stopped: credentials rejected'], [$view['checklist'][1]['state'], $view['checklist'][1]['detail']]);
        $this->assertSame('c1', $view['polling']['cursor']['value']);
        $this->getJson($this->prefix.'/device-adapters/'.$a['uuid'].'/poll-runs')->assertOk()->assertJsonPath('data.0.http_status', 401);
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/resume', ['request_uuid' => (string) Str::uuid()])->assertAccepted();
        $adapter->fresh()->update(['status' => 'running']);
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/cursor', ['request_uuid' => (string) Str::uuid(), 'start_at' => now()->subDays(31)->toIso8601String()])->assertUnprocessable();
        $this->postJson($this->prefix.'/device-adapters/'.$a['uuid'].'/cursor', ['request_uuid' => (string) Str::uuid(), 'start_at' => now()->subMinutes(30)->toIso8601String()])->assertAccepted();
        $this->assertSame(2, $adapter->fresh()->cursor_generation);
        $this->assertTrue(DB::table('activity_log')->where('event', 'device.adapter.cursor.reset')->exists());
    }

    public function test_failures_and_outcome_counts_from_the_runtime_are_recorded_once(): void
    {
        $a = $this->poll();
        $failure = ['adapter_uuid' => $a['uuid'], 'kind' => 'failure', 'report_id' => (string) Str::uuid(), 'reason' => 'decode_failed', 'error' => 'p.flow is undefined', 'source' => 'poll', 'received_at' => now()->toIso8601String(),
            'input' => ['topic' => '', 'payload_base64' => base64_encode('{"id":"x"}'), 'source' => 'poll', 'received_at' => now()->toIso8601String(), 'poll' => ['page' => 1, 'index' => 0, 'count' => 1, 'cursor' => null]]];
        $this->runtime($failure)->assertNoContent();
        $this->runtime($failure)->assertNoContent();
        $this->assertSame(1, AdapterDelivery::where('kind', 'failed')->count());
        $outcomes = ['adapter_uuid' => $a['uuid'], 'kind' => 'outcomes', 'report_id' => (string) Str::uuid(), 'bucket' => now()->startOfHour()->toIso8601String(), 'counts' => ['decoded' => 7, 'duplicate' => 2, 'bogus' => 5]];
        $this->runtime($outcomes)->assertNoContent();
        $this->runtime($outcomes)->assertNoContent();
        $counts = app(AdapterDiagnostics::class)->counts(DeviceAdapter::first());
        $this->assertSame(['decoded' => 7, 'duplicate' => 2], $counts['24h']);
        $this->artisan('adapters:prune')->assertSuccessful();
        $this->assertSame(1, AdapterDelivery::count());
    }

    public function test_another_organization_cannot_reach_http_source_records(): void
    {
        $a = $this->webhook();
        $other = Organization::create(['name' => 'Other', 'slug' => 'other', 'uuid' => (string) Str::uuid()]);
        foreach (['webhook', 'deliveries', 'poll-runs'] as $path) {
            $this->getJson('/api/v1/organizations/'.$other->uuid.'/device-adapters/'.$a['uuid'].'/'.$path)->assertNotFound();
        }
        $this->postJson('/api/v1/organizations/'.$other->uuid.'/device-adapters/'.$a['uuid'].'/webhook/secrets', ['label' => 'x'])->assertNotFound();
        $member = User::factory()->create();
        $member->organizations()->attach($other);
        $this->actingAs($member, 'sanctum')->getJson($this->prefix.'/device-adapters/'.$a['uuid'].'/webhook')->assertForbidden();
    }

    public function test_onboarding_assistant_proposes_and_a_person_applies(): void
    {
        $conversation = $this->postJson($this->prefix.'/assistant/conversations', ['scope' => 'onboarding'])->assertCreated()->json('data');
        $this->assertSame('onboarding', $conversation['scope']);
        $this->assertNull($conversation['adapter_uuid']);
        $chat = AssistantConversation::findOrFail($conversation['id']);
        $run = $chat->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
        $tool = new OnboardingTools($run);
        $call = fn (string $action, array $args = []) => json_decode((string) $tool->handle(new Request(['action' => $action, 'arguments_json' => json_encode($args)])), true);
        $this->assertSame($this->artifact, $call('find', ['kind' => 'profiles', 'query' => 'WATER'])['profiles'][0]['artifact_uuid']);
        $this->assertArrayHasKey('error', $call('status'));
        $this->assertSame('adapter', $call('recommend_path', ['path' => 'adapter', 'source_type' => 'poll', 'reason' => 'The data is only in the vendor API.'])['path']);
        // Settings with a credential in them are refused.
        $this->assertArrayHasKey('error', $call('propose_adapter', ['mode' => 'create', 'name' => 'Trackers', 'artifact_uuid' => $this->artifact, 'summary' => 'Poll the history API', 'source' => [...$this->pollSource(), 'api_key' => 'leak-me-123456']]));
        $proposal = $call('propose_adapter', ['mode' => 'create', 'name' => 'Trackers', 'artifact_uuid' => $this->artifact, 'summary' => 'Poll the history API', 'source' => $this->pollSource()]);
        $this->assertSame('create', $proposal['kind']);
        $this->assertSame(0, DeviceAdapter::count());
        $run->update(['status' => 'completed']);
        $decision = $this->postJson($this->prefix.'/assistant/conversations/'.$conversation['id'].'/adapter-proposals/'.$proposal['uuid'].'/decision', ['action' => 'apply', 'content_hash' => $proposal['content_hash'], 'request_id' => (string) Str::uuid()])->assertOk()->json('data');
        $this->assertSame('applied', $decision['status']);
        $adapter = DeviceAdapter::firstOrFail();
        $this->assertSame($adapter->id, $chat->fresh()->device_adapter_id);
        $this->assertSame([], $adapter->secrets);
        $shown = $this->getJson($this->prefix.'/assistant/conversations/'.$conversation['id'])->assertOk()->json('data');
        $this->assertSame('applied', $shown['adapter_proposals'][0]['status']);

        $adapter->update(['secrets' => ['api_key' => 'vendor-api-key-123456']]);
        $this->fetchResult['excerpt'] = '{"data":[]}';
        $run = $chat->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
        $tool = new OnboardingTools($run);
        $call = fn (string $action, array $args = []) => json_decode((string) $tool->handle(new Request(['action' => $action, 'arguments_json' => json_encode($args)])), true);
        $fetched = $call('fetch_now');
        $this->assertSame(200, $fetched['status']);
        $change = $call('propose_change', ['summary' => 'Records are under /data', 'code' => $this->code(), 'fixtures' => [['source' => 'poll', 'payload' => ['id' => 'TRK-1001-1', 'deviceId' => 'TRK-1001', 'flow' => 1, 'timestamp' => '2026-10-27T09:12:00Z']]]]);
        $this->assertSame('change', $change['kind']);
        $this->assertArrayHasKey('error', $call('propose_change', ['summary' => 'Switch to webhooks', 'source' => ['type' => 'webhook', 'auth' => ['mode' => 'url']]]));
        $context = json_encode([(new OnboardingAssistant($run))->instructions(), $call('status'), $call('samples'), AdapterProposal::all()]);
        $this->assertStringNotContainsString('vendor-api-key-123456', $context);
        $this->assertStringContainsString('"credentials_saved":["api_key"]', $context);
        $run->update(['status' => 'completed']);
        $this->postJson($this->prefix.'/assistant/conversations/'.$conversation['id'].'/adapter-proposals/'.$change['uuid'].'/decision', ['action' => 'apply', 'content_hash' => $change['content_hash'], 'request_id' => (string) Str::uuid()])->assertOk();
        $this->assertSame(2, $adapter->fresh()->draft_revision);
        $this->assertCount(1, $adapter->fresh()->fixtures);
        $this->assertSame('vendor-api-key-123456', $adapter->fresh()->secrets['api_key']);
        $this->assertSame(0, AdapterOperation::count());
    }

    public function test_another_person_cannot_decide_onboarding_proposals(): void
    {
        $conversation = $this->postJson($this->prefix.'/assistant/conversations', ['scope' => 'onboarding'])->json('data');
        $chat = AssistantConversation::findOrFail($conversation['id']);
        $run = $chat->runs()->create(['request_id' => (string) Str::uuid(), 'status' => 'running']);
        $proposal = json_decode((string) (new OnboardingTools($run))->handle(new Request(['action' => 'propose_adapter', 'arguments_json' => json_encode(['mode' => 'create', 'name' => 'Trackers', 'artifact_uuid' => $this->artifact, 'summary' => 'x', 'source' => $this->pollSource()])])), true);
        $run->update(['status' => 'completed']);
        $other = Organization::create(['name' => 'Other', 'slug' => 'other', 'uuid' => (string) Str::uuid()]);
        $this->postJson('/api/v1/organizations/'.$other->uuid.'/assistant/conversations/'.$conversation['id'].'/adapter-proposals/'.$proposal['uuid'].'/decision', ['action' => 'apply', 'content_hash' => $proposal['content_hash'], 'request_id' => (string) Str::uuid()])->assertNotFound();
        $this->assertSame(0, DeviceAdapter::count());
    }
}
