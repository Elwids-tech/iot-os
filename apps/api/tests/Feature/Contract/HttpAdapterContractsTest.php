<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Domain\DeviceAdapters\Models\AdapterDelivery;
use App\Domain\DeviceAdapters\Models\AdapterOperation;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Models\PollRun;
use App\Domain\DeviceAdapters\Models\WebhookSecret;
use App\Domain\DeviceAdapters\Services\AdapterDiagnostics;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceAdapters\Services\SourceSettings;
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
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\AssertsContracts;
use Tests\Support\ContractCase;
use Tests\TestCase;

/**
 * The control plane reads the golden examples of the adapter contracts in
 * contracts/adapters/v1 (spec 020): the receiver's reports and the tenant runtime's
 * events are accepted and applied, a Fetch now result is relayed unchanged, and the
 * source settings the control plane normalizes conform to source-settings.v1. The
 * Node side of the same contracts is services/adapters/test/contracts.test.cjs.
 */
final class HttpAdapterContractsTest extends TestCase
{
    use AssertsContracts;
    use RefreshDatabase;

    private const FIXTURE_ADAPTER = '30000000-0000-4000-8000-000000000001';

    private const FIXTURE_REVISION = '30000000-0000-4000-8000-000000000003';

    private const FIXTURE_SECRET = '30000000-0000-4000-8000-000000000004';

    private Organization $organization;

    private string $prefix;

    private string $artifact;

    /** The manager's answer to POST /poll-test. */
    private array $fetchResult = [];

    /** Creates what HttpAdapterSourcesTest::setUp creates: the organization, a profile, the adapter manager's fake answers. */
    private function adapters(): void
    {
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        Artisan::call('devices:prepare-water-meter-profile');
        $this->artifact = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $this->fetchResult = $this->golden('fetch-result.v1');
        Http::fake(function (ClientRequest $request) {
            return match (parse_url($request->url(), PHP_URL_PATH)) {
                '/test' => Http::response(['valid' => true, 'results' => [['passed' => true, 'output' => ['sourceDeviceId' => 'TRK-1001', 'metrics' => [['name' => 'flow_rate', 'value' => 12]], 'observedAt' => '2026-10-27T09:12:00.000Z']]]]),
                '/deploy' => Http::response(['applied' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']),
                '/poll-test' => Http::response($this->fetchResult),
                '/webhook' => Http::response(['configured' => true]),
                default => Http::response(['connected' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']),
            };
        });
        Queue::fake();
    }

    private function configure(): void
    {
        config(['devices.runtime_token' => str_repeat('r', 64), 'devices.broker_admin_token' => 'test-token', 'adapters.enabled' => true, 'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64),
            'adapters.webhook_public_url' => 'https://hooks.example.com', 'adapters.receiver_token' => str_repeat('w', 48), 'adapters.allow_private_endpoints' => false]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->configure();
    }

    private const CONTRACTS = 'adapters/v1/';

    private static function schema(string $stem): string
    {
        return self::CONTRACTS.$stem.'.schema.json';
    }

    /** The golden fixture, as JSON text. */
    private function fixtureJson(string $stem): string
    {
        return (string) file_get_contents(self::contractsRoot().'/'.self::CONTRACTS.$stem.'.fixture.json');
    }

    private function golden(string $stem): array
    {
        return json_decode($this->fixtureJson($stem), true, 512, JSON_THROW_ON_ERROR);
    }

    /** @return list<ContractCase> */
    private static function validCases(string $stem): array
    {
        $cases = self::contractCases(self::schema($stem));

        return array_values(array_map(fn (array $entry) => $entry[0], array_filter($cases, fn (array $entry) => $entry[0]->valid)));
    }

    /**
     * Posts raw JSON so empty objects stay objects, as the receiver and the runtime send them.
     *
     * @param  array<string, string>  $headers
     */
    private function postRaw(string $uri, string $json, array $headers = [])
    {
        return $this->call('POST', $uri, [], [], [], $this->transformHeadersToServerVars(['CONTENT_TYPE' => 'application/json', 'Accept' => 'application/json', ...$headers]), $json);
    }

    private function receiver(string $json)
    {
        return $this->postRaw('/api/internal/adapters/receiver-reports', $json, ['Authorization' => 'Bearer '.str_repeat('w', 48)]);
    }

    private function runtime(string $json)
    {
        $tenant = app(AdapterService::class)->tenant($this->organization);

        return $this->postRaw('/api/internal/adapters/events', $json, ['X-Adapter-Tenant' => $tenant->uuid, 'Authorization' => 'Bearer '.$tenant->runtime_token]);
    }

    private function code(): string
    {
        return 'function decode(input){const p=input.payload;return {sourceDeviceId:p.deviceId,metrics:[{name:"flow_rate",value:p.flow}],observedAt:p.timestamp,messageId:p.id}}';
    }

    private function createAdapter(array $source, array $extra = []): array
    {
        return $this->postJson($this->prefix.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'Contract adapter', 'artifact_uuid' => $this->artifact, 'source' => $source, 'code' => $this->code(), 'fixtures' => [], ...$extra])->assertCreated()->json('data');
    }

    private function pollAdapter(): array
    {
        $source = $this->golden('source-settings.v1');
        $source['credentials'] = ['placement' => 'header', 'name' => 'x-api-key'];

        return $this->createAdapter($source, ['secrets' => ['api_key' => 'vendor-api-key-123456'], 'fixtures' => [['source' => 'poll', 'payload' => ['id' => 'TRK-1001-1', 'deviceId' => 'TRK-1001', 'flow' => 12, 'timestamp' => '2026-10-27T09:12:00Z']]]]);
    }

    private function deploy(array $adapter): DeviceAdapter
    {
        $this->postJson($this->prefix.'/device-adapters/'.$adapter['uuid'].'/test', ['draft_revision' => 1])->assertOk();
        $this->postJson($this->prefix.'/device-adapters/'.$adapter['uuid'].'/deploy', ['request_uuid' => (string) Str::uuid(), 'draft_revision' => 1, 'cursor_start_at' => now()->subHours(2)->toIso8601String()])->assertAccepted();
        app(AdapterService::class)->deploy(AdapterOperation::firstOrFail());

        return DeviceAdapter::where('uuid', $adapter['uuid'])->firstOrFail()->fresh();
    }

    public function test_the_receiver_report_fixture_is_accepted_and_applied(): void
    {
        $this->adapters();
        $adapter = $this->createAdapter(['type' => 'webhook', 'auth' => ['mode' => 'hmac', 'signature_header' => 'x-signature', 'prefix' => 'sha256=']]);
        $secret = $this->postJson($this->prefix.'/device-adapters/'.$adapter['uuid'].'/webhook/secrets', ['label' => 'Vendor console'])->assertCreated()->json('data.secret');

        $json = strtr($this->fixtureJson('receiver-report.v1'), [self::FIXTURE_ADAPTER => $adapter['uuid'], self::FIXTURE_SECRET => $secret['uuid']]);
        $this->assertProducedJson(self::schema('receiver-report.v1'), $json);
        $this->receiver($json)->assertNoContent();

        $counts = app(AdapterDiagnostics::class)->counts(DeviceAdapter::firstOrFail());
        $this->assertSame(['accepted' => 12, 'unauthenticated' => 1], $counts['24h']);
        $rejected = AdapterDelivery::where('kind', 'rejected')->firstOrFail();
        $this->assertSame('unauthenticated', $rejected->reason);
        $this->assertSame('203.0.113.7', $rejected->source_address);
        $this->assertNull($rejected->input);
        $sample = AdapterDelivery::where('kind', 'sample')->firstOrFail();
        $this->assertSame('/uplink', $sample->input['http']['path']);
        $this->assertSame(['kind' => 'env'], $sample->input['http']['query']);
        $this->assertNotNull(WebhookSecret::where('uuid', $secret['uuid'])->firstOrFail()->last_used_at);
        // The same report again changes nothing.
        $this->receiver($json)->assertNoContent();
        $this->assertSame(1, AdapterDelivery::where('kind', 'sample')->count());
    }

    public function test_every_valid_receiver_report_case_is_accepted(): void
    {
        $this->adapters();
        $adapter = $this->createAdapter(['type' => 'webhook', 'auth' => ['mode' => 'hmac', 'signature_header' => 'x-signature']]);
        foreach (self::validCases('receiver-report.v1') as $case) {
            $json = strtr($case->json, [self::FIXTURE_ADAPTER => $adapter['uuid']]);
            $this->receiver($json)->assertNoContent();
        }
        // A report of the wrong schema version is refused, like any other body that breaks the contract.
        $wrong = str_replace('receiver-report.v1', 'receiver-report.v2', $this->fixtureJson('receiver-report.v1'));
        $this->receiver($wrong)->assertUnprocessable();
    }

    public function test_the_runtime_event_fixture_is_accepted_and_every_valid_event_is_applied(): void
    {
        $this->adapters();
        $adapter = $this->deploy($this->pollAdapter());
        $replace = [self::FIXTURE_ADAPTER => $adapter->uuid, self::FIXTURE_REVISION => $adapter->applied_revision_uuid];
        $this->assertNotNull($adapter->applied_revision_uuid);

        $fixture = strtr($this->fixtureJson('runtime-event.v1'), $replace);
        $this->assertProducedJson(self::schema('runtime-event.v1'), $fixture);
        $this->runtime($fixture)->assertNoContent();
        $this->assertSame(1, PollRun::count());
        $run = PollRun::firstOrFail();
        $this->assertSame('ok', $run->outcome);
        $this->assertSame(200, $run->http_status);
        $this->assertSame(2, $run->records);
        $this->assertSame('polling', $adapter->fresh()->poll_state['state']);
        $this->assertSame('2026-10-27T09:12:00.000Z', $adapter->fresh()->poll_state['cursor']['value']);

        foreach (self::validCases('runtime-event.v1') as $case) {
            $event = json_decode(strtr($case->json, $replace), true, 512, JSON_THROW_ON_ERROR);
            if ($event['kind'] === 'outcomes') {
                // Counts older than 24 hours do not show in the adapter's counts.
                $event['bucket'] = now()->utc()->startOfHour()->format('Y-m-d\TH:i:s.000\Z');
            }
            $this->runtime(json_encode($event, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION))->assertNoContent();
        }
        $adapter = $adapter->fresh();
        $this->assertSame(2, PollRun::count());
        $this->assertSame('stopped', $adapter->poll_state['state']);
        $this->assertSame('Credentials rejected', $adapter->poll_state['reason']);
        $this->assertSame(1, $adapter->candidates()->where('source_device_id', 'TRK-1001')->count());
        $this->assertSame(['webhook', 'poll'], AdapterDelivery::where('kind', 'failed')->orderBy('id')->pluck('source')->all());
        $this->assertSame('decode_failed', AdapterDelivery::where('kind', 'failed')->orderBy('id')->value('reason'));
        $this->assertTrue($adapter->health['upstream_connected']);
        $counts = app(AdapterDiagnostics::class)->counts($adapter)['24h'];
        ksort($counts);
        $this->assertSame(['decode_failed' => 1, 'decoded' => 7, 'duplicate' => 2], $counts);

        // An event for a revision that is neither applied nor desired is dropped, not applied.
        $stale = strtr($this->fixtureJson('runtime-event.v1'), [self::FIXTURE_ADAPTER => $adapter->uuid, self::FIXTURE_REVISION => (string) Str::uuid(), '30000000-0000-4000-8000-000000000013' => (string) Str::uuid()]);
        $this->runtime($stale)->assertNoContent();
        $this->assertSame(2, PollRun::count());
        // A body that breaks the contract's enumerations is refused.
        $this->runtime(str_replace('"outcome": "ok"', '"outcome": "done"', $fixture))->assertUnprocessable();
    }

    public function test_fetch_now_relays_the_golden_result_unchanged(): void
    {
        $this->adapters();
        $adapter = $this->pollAdapter();
        $result = $this->postJson($this->prefix.'/device-adapters/'.$adapter['uuid'].'/fetch-now', ['draft_revision' => 1])->assertOk()->json('data');
        $this->assertSame($this->golden('fetch-result.v1'), $result);
        $this->assertProduced(self::schema('fetch-result.v1'), $result);
    }

    /** @return array<string, array{ContractCase}> */
    public static function normalizedSettingsCases(): array
    {
        return array_filter(self::contractCases(self::schema('source-settings.v1')), fn (array $entry) => $entry[0]->valid);
    }

    #[DataProvider('normalizedSettingsCases')]
    public function test_normalized_source_settings_conform_and_normalizing_them_again_changes_nothing(ContractCase $case): void
    {
        $settings = $case->data();
        $normalized = app(SourceSettings::class)->normalize($settings);

        $this->assertProduced(self::schema('source-settings.v1'), $normalized);
        $this->assertSame($settings, $normalized);
    }

    public function test_the_control_plane_normalizes_a_minimal_polling_source_to_the_golden_fixture(): void
    {
        $minimal = ['type' => 'poll', 'request' => ['method' => 'GET', 'url' => 'https://api.example.com/accounts/A1/streams/history', 'query' => [['name' => 'start', 'value' => '{cursor}'], ['name' => 'end', 'value' => '{now}']]],
            'credentials' => ['placement' => 'header', 'name' => 'x-api-key'], 'page' => ['size' => 500, 'size_param' => 'limit'], 'records' => '/data', 'cursor' => ['kind' => 'timestamp', 'pointer' => '/maxDate']];

        $this->assertSame($this->golden('source-settings.v1'), app(SourceSettings::class)->normalize($minimal));
    }
}
