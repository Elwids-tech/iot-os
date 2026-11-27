<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceAdapters;

use App\Domain\DeviceAdapters\Models\AdapterConnection;
use App\Domain\DeviceAdapters\Models\AdapterTenant;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceAdapters\Services\Connections;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/** OPC UA connections and browsing (spec 038 PR 3, contracts/api.md). */
final class ConnectionTest extends TestCase
{
    use RefreshDatabase;

    private const FINGERPRINT = '8598fc68c9a75d9c4cad944c72a9a04759108a886edc8f5deee52b40406bdd72';

    private const REASONS = ['unreachable', 'address_not_allowed', 'no_shared_security', 'server_certificate_changed', 'client_certificate_untrusted', 'sign_in_refused', 'server_busy', 'clock_difference', 'timeout'];

    private Organization $organization;

    private string $prefix;

    /** @var list<array{path: string, body: array}> */
    private array $manager = [];

    /** @var array<string, array> answers by manager path */
    private array $answers = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid.'/adapter-connections';
        config(['adapters.enabled' => true, 'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64)]);
        $certificate = ['subject' => 'CN=Example Tower BMS simulator', 'fingerprint' => self::FINGERPRINT, 'valid_from' => '2026-11-27T13:05:42.000Z', 'valid_to' => '2027-11-27T13:05:42.000Z', 'application_uri' => 'urn:example:bms:example-tower', 'der' => 'MIIB'];
        $this->answers = [
            '/opcua/endpoints' => ['endpoints' => [
                ['policy' => 'Basic256Sha256', 'mode' => 'SignAndEncrypt', 'label' => 'Encrypted (Basic256Sha256)', 'strength' => 32, 'refused' => null, 'warning' => null, 'endpoint_url' => 'opc.tcp://bms.example.com:4840/', 'sign_in' => ['anonymous', 'username'], 'server_fingerprint' => self::FINGERPRINT, 'server_certificate' => $certificate],
                ['policy' => 'None', 'mode' => 'None', 'label' => 'Not encrypted', 'strength' => 0, 'refused' => null, 'warning' => 'Values and sign-in travel unencrypted', 'endpoint_url' => 'opc.tcp://bms.example.com:4840/', 'sign_in' => ['anonymous'], 'server_fingerprint' => self::FINGERPRINT, 'server_certificate' => $certificate],
            ]],
            '/opcua/test' => ['connected' => true, 'limits' => ['MaxNodesPerRead' => 10000, 'MaxNodesPerBrowse' => 10000, 'MaxNodesPerTranslateBrowsePathsToNodeIds' => 10000, 'MaxMonitoredItemsPerCall' => 10000], 'clock_difference_ms' => -41,
                'security' => ['policy' => 'Basic256Sha256', 'mode' => 'SignAndEncrypt', 'label' => 'Encrypted (Basic256Sha256)', 'warning' => null, 'server_fingerprint' => self::FINGERPRINT]],
            '/opcua/browse' => ['items' => [['node_id' => 's=L03-VAV-2', 'namespace_uri' => 'urn:example:bms:example-tower', 'name' => 'L03-VAV-2', 'display_name' => 'L03-VAV-2', 'kind' => 'object', 'type' => 'Zone box with reheat', 'has_children' => true]], 'cursor' => null],
            '/opcua/read' => ['points' => [['node_id' => 's=L03-VAV-2.zone_temperature', 'namespace_uri' => 'urn:example:bms:example-tower', 'value' => 22.5, 'data_type' => 'number', 'unit' => '°C', 'range' => [10, 35], 'states' => null, 'status' => 'Good', 'quality' => 'good', 'reason' => null, 'source_time' => '2026-11-27T13:05:42.000Z', 'storable' => true, 'not_storable' => null]]],
            '/opcua/search' => ['matches' => [], 'visited' => 120, 'truncated' => false],
        ];
        Http::fake(function (ClientRequest $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            $this->manager[] = ['path' => $path, 'body' => $request->data()];

            return Http::response($this->answers[$path] ?? ['error' => 'unknown'], isset($this->answers[$path]) ? 200 : 422);
        });
    }

    private function connection(array $change = []): array
    {
        return $this->postJson($this->prefix, array_replace(['name' => 'Example Tower BMS', 'endpoint_url' => 'opc.tcp://bms.example.com:4840', 'security_policy' => 'Basic256Sha256',
            'security_mode' => 'SignAndEncrypt', 'identity' => 'username', 'username' => 'operator', 'password' => 'placeholder-site-password'], $change))->assertCreated()->json('data');
    }

    private function trusted(array $change = []): array
    {
        $connection = $this->connection($change);
        $this->postJson("{$this->prefix}/{$connection['uuid']}/endpoints")->assertOk();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/server-certificate/accept", ['fingerprint' => self::FINGERPRINT])->assertOk();

        return $connection;
    }

    private function last(string $path): array
    {
        $calls = array_values(array_filter($this->manager, fn ($call) => $call['path'] === $path));

        return end($calls)['body'];
    }

    public function test_a_connection_is_saved_with_a_platform_certificate_and_never_shows_a_secret(): void
    {
        $connection = $this->connection();
        $this->assertSame('draft', $connection['state']);
        $this->assertSame('Encrypted (Basic256Sha256)', $connection['security_label']);
        $this->assertSame('operator', $connection['username']);
        $this->assertTrue($connection['has_password']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $connection['client_certificate']['fingerprint']);
        $this->assertArrayNotHasKey('secrets', $connection);
        $json = $this->getJson("{$this->prefix}/{$connection['uuid']}")->assertOk()->getContent();
        $this->assertStringNotContainsString('placeholder-site-password', $json);
        $this->assertStringNotContainsString('PRIVATE KEY', $json);
        $this->assertStringNotContainsString('placeholder-site-password', $this->getJson($this->prefix)->getContent());

        $pem = $this->get("{$this->prefix}/{$connection['uuid']}/client-certificate?format=pem")->assertOk()->getContent();
        $parsed = openssl_x509_parse($pem);
        $this->assertSame("URI:urn:iot-os:{$this->organization->uuid}:opcua:{$connection['uuid']}", $parsed['extensions']['subjectAltName']);
        $this->assertStringContainsString('TLS Web Client Authentication', $parsed['extensions']['extendedKeyUsage']);
        $this->assertGreaterThan(now()->addYears(4)->timestamp, $parsed['validTo_time_t']);
        $der = $this->get("{$this->prefix}/{$connection['uuid']}/client-certificate")->assertOk();
        $this->assertSame('application/pkix-cert', $der->headers->get('Content-Type'));
        $this->assertSame($connection['client_certificate']['fingerprint'], hash('sha256', $der->getContent()));
    }

    public function test_saving_checks_the_address_security_and_sign_in(): void
    {
        $base = ['name' => 'BMS', 'endpoint_url' => 'opc.tcp://bms.example.com:4840', 'security_policy' => 'Basic256Sha256', 'security_mode' => 'SignAndEncrypt', 'identity' => 'anonymous'];
        $this->postJson($this->prefix, ['endpoint_url' => 'https://bms.example.com'] + $base)->assertUnprocessable()->assertJsonValidationErrors('endpoint_url');
        $this->postJson($this->prefix, ['endpoint_url' => 'opc.tcp://user:pass@bms.example.com:4840'] + $base)->assertUnprocessable()->assertJsonValidationErrors('endpoint_url');
        $this->postJson($this->prefix, ['security_policy' => 'Basic256'] + $base)->assertUnprocessable()->assertJsonValidationErrors('security_policy');
        $this->postJson($this->prefix, ['security_mode' => 'None'] + $base)->assertUnprocessable();
        $this->postJson($this->prefix, ['security_policy' => 'None', 'security_mode' => 'None'] + $base)->assertUnprocessable()->assertJsonPath('message', 'Confirm that values and sign-in may travel unencrypted.');
        $this->postJson($this->prefix, ['identity' => 'username', 'username' => 'operator'] + $base)->assertUnprocessable()->assertJsonPath('message', 'Enter the user name and password the server expects.');
        $plain = $this->postJson($this->prefix, ['security_policy' => 'None', 'security_mode' => 'None', 'unencrypted_confirmed' => true] + $base)->assertCreated()->json('data');
        $this->assertSame('Not encrypted', $plain['security_label']);
        $this->assertNotNull($plain['unencrypted_confirmed_by']);
    }

    public function test_the_connection_limit_and_duplicates(): void
    {
        config(['adapters.opcua.max_connections' => 2]);
        $this->connection();
        $this->postJson($this->prefix, ['name' => 'Same server, same way', 'endpoint_url' => 'opc.tcp://bms.example.com:4840', 'security_policy' => 'Basic256Sha256', 'security_mode' => 'SignAndEncrypt', 'identity' => 'username', 'username' => 'other', 'password' => 'placeholder'])
            ->assertUnprocessable()->assertJsonPath('message', 'The connection "Example Tower BMS" already reaches this server the same way. Use it instead.');
        $this->postJson($this->prefix, ['name' => 'Example Tower BMS', 'endpoint_url' => 'opc.tcp://other.example.com:4840', 'security_policy' => 'Basic256Sha256', 'security_mode' => 'SignAndEncrypt', 'identity' => 'anonymous'])
            ->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->connection(['name' => 'Second', 'endpoint_url' => 'opc.tcp://other.example.com:4840']);
        $this->postJson($this->prefix, ['name' => 'Third', 'endpoint_url' => 'opc.tcp://third.example.com:4840', 'security_policy' => 'Basic256Sha256', 'security_mode' => 'SignAndEncrypt', 'identity' => 'anonymous'])
            ->assertUnprocessable()->assertJsonPath('message', 'This organization has reached its limit of 2 OPC UA connections.');
    }

    public function test_the_server_certificate_waits_for_review_and_only_the_pending_one_can_be_accepted(): void
    {
        $connection = $this->connection();
        $offered = $this->postJson("{$this->prefix}/{$connection['uuid']}/endpoints")->assertOk()->json('data');
        $this->assertSame('Encrypted (Basic256Sha256)', $offered['endpoints'][0]['label']);
        $this->assertArrayNotHasKey('der', $offered['endpoints'][0]['server_certificate']);
        $this->assertSame('awaiting_trust', $offered['connection']['state']);
        $this->assertSame(self::FINGERPRINT, $offered['connection']['pending_server_certificate']['fingerprint']);
        $this->postJson("{$this->prefix}/{$connection['uuid']}/server-certificate/accept", ['fingerprint' => str_repeat('0', 64)])->assertConflict();
        $accepted = $this->postJson("{$this->prefix}/{$connection['uuid']}/server-certificate/accept", ['fingerprint' => self::FINGERPRINT])->assertOk()->json('data');
        $this->assertSame('draft', $accepted['state']);
        $this->assertSame(self::FINGERPRINT, $accepted['server_certificate']['fingerprint']);
        $this->assertNull($accepted['pending_server_certificate']);
        $this->assertDatabaseHas('activity_log', ['event' => 'device.adapter_connection.server_certificate_accepted']);
    }

    public function test_a_test_sends_the_connection_secrets_and_ranges_and_records_connected(): void
    {
        app(AdapterService::class)->tenant($this->organization)->update(['private_ranges' => ['10.20.0.0/16']]);
        $connection = $this->trusted();
        $result = $this->postJson("{$this->prefix}/{$connection['uuid']}/test")->assertOk()->json('data');
        $this->assertTrue($result['connected']);
        $this->assertSame('connected', $result['connection']['state']);
        $this->assertSame(10000, $result['connection']['status']['limits']['MaxNodesPerRead']);
        $sent = $this->last('/opcua/test');
        $this->assertSame(self::FINGERPRINT, $sent['connection']['server_fingerprint']);
        $this->assertSame('placeholder-site-password', $sent['secrets']['password']);
        $this->assertStringContainsString('PRIVATE KEY', $sent['secrets']['client_private_key']);
        $this->assertSame(['10.20.0.0/16'], $sent['private_ranges']);
    }

    public function test_each_failure_reason_comes_back_with_its_fix(): void
    {
        $connection = $this->trusted();
        foreach (self::REASONS as $reason) {
            $this->answers['/opcua/test'] = ['reason' => $reason, 'message' => "Message for {$reason}", 'fix' => "Fix for {$reason}"];
            $result = $this->postJson("{$this->prefix}/{$connection['uuid']}/test")->assertOk()->json('data');
            $this->assertFalse($result['connected']);
            $this->assertSame([$reason, "Message for {$reason}", "Fix for {$reason}"], [$result['reason'], $result['message'], $result['fix']]);
            $this->assertSame($reason === 'server_certificate_changed' ? 'stopped' : 'unreachable', $result['connection']['state']);
            $this->answers['/opcua/browse'] = ['reason' => $reason, 'message' => "Message for {$reason}", 'fix' => "Fix for {$reason}"];
            $this->getJson("{$this->prefix}/{$connection['uuid']}/nodes")->assertUnprocessable()->assertJsonPath('reason', $reason)->assertJsonPath('fix', "Fix for {$reason}");
        }
        $this->assertCount(9, AdapterConnection::where('uuid', $connection['uuid'])->first()->status['problems']);
    }

    public function test_a_changed_certificate_stops_the_connection_until_the_new_one_is_accepted(): void
    {
        $connection = $this->trusted();
        $presented = ['subject' => 'CN=Renewed', 'fingerprint' => str_repeat('a', 64), 'valid_from' => null, 'valid_to' => null, 'application_uri' => null, 'der' => 'MIIB'];
        $this->answers['/opcua/test'] = ['reason' => 'server_certificate_changed', 'message' => 'Changed', 'fix' => 'Review it', 'server_certificate' => $presented];
        $result = $this->postJson("{$this->prefix}/{$connection['uuid']}/test")->assertOk()->json('data');
        $this->assertSame('stopped', $result['connection']['state']);
        $this->assertSame(str_repeat('a', 64), $result['connection']['pending_server_certificate']['fingerprint']);
        $this->postJson("{$this->prefix}/{$connection['uuid']}/server-certificate/accept", ['fingerprint' => str_repeat('a', 64)])->assertOk()->assertJsonPath('data.state', 'draft');
    }

    public function test_browsing_reading_and_searching_pass_nodes_through(): void
    {
        $connection = $this->trusted();
        $this->getJson("{$this->prefix}/{$connection['uuid']}/nodes")->assertOk()->assertJsonPath('data.items.0.type', 'Zone box with reheat');
        $this->assertNull($this->last('/opcua/browse')['parent']);
        $this->getJson("{$this->prefix}/{$connection['uuid']}/nodes?parent=".urlencode('nsu=urn:example:bms:example-tower;s=L03-Z2').'&cursor=local:abc')->assertOk();
        $this->assertSame(['node_id' => 's=L03-Z2', 'namespace_uri' => 'urn:example:bms:example-tower'], $this->last('/opcua/browse')['parent']);
        $this->assertSame('local:abc', $this->last('/opcua/browse')['cursor']);
        $this->getJson("{$this->prefix}/{$connection['uuid']}/nodes?parent=".urlencode('ns=2;s=L03-Z2'))->assertUnprocessable();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/nodes/read", ['nodes' => ['nsu=urn:example:bms:example-tower;s=L03-VAV-2.zone_temperature']])->assertOk()->assertJsonPath('data.points.0.unit', '°C');
        $this->postJson("{$this->prefix}/{$connection['uuid']}/nodes/read", ['nodes' => array_fill(0, 201, 'nsu=urn:x;i=1')])->assertUnprocessable();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/nodes/search", ['text' => 'VAV-2'])->assertOk()->assertJsonPath('data.truncated', false);
        $this->assertSame('VAV-2', $this->last('/opcua/search')['text']);
    }

    public function test_browsing_is_throttled_per_connection(): void
    {
        config(['adapters.opcua.browse_per_minute' => 3]);
        $one = $this->trusted();
        $two = $this->trusted(['name' => 'Other', 'endpoint_url' => 'opc.tcp://other.example.com:4840']);
        // Two of the three calls went to /endpoints while each connection was set up.
        $this->getJson("{$this->prefix}/{$one['uuid']}/nodes")->assertOk();
        $this->getJson("{$this->prefix}/{$one['uuid']}/nodes")->assertOk();
        $this->getJson("{$this->prefix}/{$one['uuid']}/nodes")->assertTooManyRequests();
        $this->getJson("{$this->prefix}/{$two['uuid']}/nodes")->assertOk();
    }

    public function test_pause_resume_and_secrets_kept_when_left_out(): void
    {
        $connection = $this->trusted();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/pause")->assertOk()->assertJsonPath('data.state', 'paused');
        $this->getJson("{$this->prefix}/{$connection['uuid']}/nodes")->assertConflict();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/test")->assertConflict();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/resume")->assertOk()->assertJsonPath('data.state', 'draft');
        $this->putJson("{$this->prefix}/{$connection['uuid']}", ['name' => 'Renamed'])->assertOk()->assertJsonPath('data.name', 'Renamed')->assertJsonPath('data.has_password', true);
        $this->assertSame('placeholder-site-password', AdapterConnection::where('uuid', $connection['uuid'])->first()->secrets['password']);
        $this->putJson("{$this->prefix}/{$connection['uuid']}", ['password' => 'placeholder-new-password'])->assertOk();
        $this->assertSame('placeholder-new-password', AdapterConnection::where('uuid', $connection['uuid'])->first()->secrets['password']);
        $this->putJson("{$this->prefix}/{$connection['uuid']}", ['endpoint_url' => 'opc.tcp://moved.example.com:4840'])->assertOk()->assertJsonPath('data.server_certificate', null);
    }

    public function test_every_change_is_audited_without_secret_values(): void
    {
        $connection = $this->trusted();
        $this->putJson("{$this->prefix}/{$connection['uuid']}", ['password' => 'placeholder-new-password', 'name' => 'Renamed'])->assertOk();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/pause")->assertOk();
        $this->postJson("{$this->prefix}/{$connection['uuid']}/resume")->assertOk();
        $this->deleteJson("{$this->prefix}/{$connection['uuid']}")->assertNoContent();
        $events = DB::table('activity_log')->where('event', 'like', 'device.adapter_connection.%')->pluck('event')->all();
        foreach (['created', 'server_certificate_accepted', 'changed', 'credentials_changed', 'paused', 'resumed', 'deleted'] as $action) {
            $this->assertContains("device.adapter_connection.{$action}", $events);
        }
        $logged = DB::table('activity_log')->where('event', 'like', 'device.adapter_connection.%')->pluck('properties')->implode(' ');
        $this->assertStringNotContainsString('placeholder', $logged);
        $this->assertStringNotContainsString('PRIVATE KEY', $logged);
    }

    public function test_a_connection_in_use_cannot_be_deleted(): void
    {
        $connection = $this->connection();
        $id = AdapterConnection::where('uuid', $connection['uuid'])->value('id');
        $adapter = DB::table('device_adapters')->first();
        if ($adapter === null) {
            $this->markTestIncomplete('The seeders created no data source to attach.');
        }
        DB::table('device_adapters')->where('id', $adapter->id)->update(['adapter_connection_id' => $id]);
        $this->deleteJson("{$this->prefix}/{$connection['uuid']}")->assertConflict()->assertJsonPath('message', 'A data source reads through this connection. Remove the data source first.');
        DB::table('device_adapters')->where('id', $adapter->id)->update(['adapter_connection_id' => null]);
        $this->deleteJson("{$this->prefix}/{$connection['uuid']}")->assertNoContent();
    }

    public function test_another_organization_gets_404_on_every_route(): void
    {
        $connection = $this->trusted();
        $other = Organization::where('id', '!=', $this->organization->id)->firstOrFail();
        $base = "/api/v1/organizations/{$other->uuid}/adapter-connections/{$connection['uuid']}";
        $this->getJson($base)->assertNotFound();
        $this->putJson($base, ['name' => 'Taken'])->assertNotFound();
        $this->deleteJson($base)->assertNotFound();
        foreach (['endpoints', 'test', 'pause', 'resume', 'nodes/read', 'nodes/search'] as $route) {
            $this->postJson("{$base}/{$route}", ['nodes' => ['nsu=urn:x;i=1'], 'text' => 'x', 'fingerprint' => self::FINGERPRINT])->assertNotFound();
        }
        $this->postJson("{$base}/server-certificate/accept", ['fingerprint' => self::FINGERPRINT])->assertNotFound();
        $this->getJson("{$base}/nodes")->assertNotFound();
        $this->getJson("{$base}/client-certificate")->assertNotFound();
        $this->assertSame([], array_filter($this->manager, fn ($call) => str_contains(json_encode($call['body']), (string) $other->uuid)));
        $this->assertNotContains($connection['uuid'], $this->getJson("/api/v1/organizations/{$other->uuid}/adapter-connections")->json('data.*.uuid') ?? []);
    }

    public function test_without_adapters_the_routes_are_not_there(): void
    {
        config(['adapters.enabled' => false]);
        $this->getJson($this->prefix)->assertNotFound();
    }

    public function test_an_opc_ua_data_source_waits_for_point_maps(): void
    {
        $this->postJson('/api/v1/organizations/'.$this->organization->uuid.'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'BMS', 'artifact_uuid' => (string) Str::uuid(), 'source' => ['type' => 'opcua'], 'code' => '', 'fixtures' => []])
            ->assertUnprocessable();
    }

    public function test_private_ranges_are_staff_only_and_never_reach_what_is_never_reachable(): void
    {
        $route = "/api/v1/admin/organizations/{$this->organization->uuid}/adapter-private-ranges";
        $this->getJson($route)->assertOk()->assertJsonPath('data.private_ranges', []);
        $this->putJson($route, ['private_ranges' => ['10.20.0.0/16', '192.0.2.0/24']])->assertOk()->assertJsonPath('data.private_ranges', ['10.20.0.0/16', '192.0.2.0/24']);
        $this->assertSame(['10.20.0.0/16', '192.0.2.0/24'], AdapterTenant::where('organization_id', $this->organization->id)->value('private_ranges'));
        foreach (['127.0.0.0/8', '169.254.169.254/32', '0.0.0.0/0', '::1/128', 'fe80::/64', 'not-a-range', '10.0.0.0/33'] as $range) {
            $this->putJson($route, ['private_ranges' => [$range]])->assertUnprocessable();
        }
        config(['adapters.opcua.platform_ranges' => ['172.18.0.0/16']]);
        $this->putJson($route, ['private_ranges' => ['172.16.0.0/12']])->assertUnprocessable()->assertJsonPath('message', '172.16.0.0/12 includes 172.18.0.0/16, which an organization can never reach.');
        $this->assertDatabaseHas('activity_log', ['event' => 'device.adapter_tenant.private_ranges_changed']);
        $member = User::factory()->create();
        $member->organizations()->attach($this->organization->id);
        $this->actingAs($member, 'sanctum')->getJson($route)->assertForbidden();
        $this->assertSame(['10.20.0.0/16'], Connections::checkRanges([' 10.20.0.0/16 ', '10.20.0.0/16']));
    }
}
