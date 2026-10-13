<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Agents;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Support\Agents\AgentFixtures;
use Tests\TestCase;

/** The troubleshooting tools through /mcp, with the runtime faked (spec 004 US2). */
final class AgentReadToolsTest extends TestCase
{
    use AgentFixtures, RefreshDatabase;

    private Organization $acme;

    private Device $device;

    private Site $site;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->usePassportTestKeys();
        config(['agents.enabled' => true, 'app.frontend_url' => 'https://app.example.test', 'devices.runtime_token' => str_repeat('x', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        $this->withoutMiddleware(ValidateCsrfToken::class);
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->acme->forceFill(['agent_access_enabled' => true])->save();
        $this->site = Site::create(['organization_id' => $this->acme->id, 'name' => 'North plant', 'timezone' => 'America/Toronto']);
        $this->device = Device::create(['organization_id' => $this->acme->id, 'code' => 'boiler-1', 'name' => 'Boiler room sensor', 'site_id' => $this->site->id, 'lifecycle' => 'active', 'deployment_status' => 'applied', 'presence' => 'offline', 'last_seen_at' => now()->subHours(2)]);
        $this->token = $this->connectAgent(User::where('email', 'shared.operator@example.test')->firstOrFail(), $this->acme)['access_token'];
    }

    public function test_device_health_reports_readings_and_says_when_they_are_unavailable(): void
    {
        // The runtime answers once, then is down.
        Http::fake(['*/internal/measurements/latest*' => Http::sequence()->push(['data' => [
            ['parameter_uuid' => (string) Str::uuid(), 'key' => 'temperature', 'label' => 'Temperature', 'unit' => '°C', 'value' => 71.5, 'quality' => 'stale', 'observed_at' => now()->subHours(2)->toIso8601String(), 'diagnostic' => 'No reading for 2 hours'],
        ]])->push([], 503)]);

        $health = $this->callTool($this->token, 'get_device_health', ['device_uuid' => $this->device->uuid]);
        $this->assertFalse($health['error']);
        $data = $health['body']['data'];
        $this->assertSame('Boiler room sensor', $data['device']['name']);
        $this->assertSame('offline', $data['device']['presence']);
        $this->assertSame('America/Toronto', $data['device']['reporting_timezone']);
        $this->assertSame('stale', $data['readings'][0]['quality']);
        $this->assertGreaterThan(7000, $data['readings'][0]['age_seconds']);
        $this->assertNull($data['readings_unavailable']);

        $down = $this->callTool($this->token, 'get_device_health', ['device_uuid' => $this->device->uuid]);
        $this->assertFalse($down['error']);
        $this->assertNull($down['body']['data']['readings']);
        $this->assertNotNull($down['body']['data']['readings_unavailable']);
    }

    public function test_measurements_pass_the_window_to_the_runtime_and_validate_input(): void
    {
        $parameter = (string) Str::uuid();
        Http::fake(['*/internal/measurements/history*' => Http::response(['data' => ['points' => [['at' => now()->toIso8601String(), 'avg' => 1.5]]]])]);

        $history = $this->callTool($this->token, 'get_measurements', ['device_uuid' => $this->device->uuid, 'parameter_uuid' => $parameter, 'from' => now()->subDay()->toIso8601String(), 'to' => now()->toIso8601String(), 'max_points' => 50]);
        $this->assertFalse($history['error']);
        $this->assertSame('history', $history['body']['data']['kind']);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/internal/measurements/history') && $request['max_points'] == 50 && $request['parameter_uuid'] === $parameter && $request['organization_uuid'] === $this->acme->uuid);

        $missingBucket = $this->callTool($this->token, 'get_measurements', ['device_uuid' => $this->device->uuid, 'parameter_uuid' => $parameter, 'kind' => 'increase', 'from' => now()->subDay()->toIso8601String(), 'to' => now()->toIso8601String()]);
        $this->assertSame('invalid_input', $missingBucket['body']['error']['code']);
        $tooMany = $this->callTool($this->token, 'get_measurements', ['device_uuid' => $this->device->uuid, 'parameter_uuid' => $parameter, 'max_points' => 1000, 'from' => now()->subDay()->toIso8601String(), 'to' => now()->toIso8601String()]);
        $this->assertSame('invalid_input', $tooMany['body']['error']['code']);
    }

    public function test_diagnostics_explain_a_device_that_stopped_reporting(): void
    {
        Http::fake(['*' => Http::response([], 503)]);

        $result = $this->callTool($this->token, 'get_ingestion_diagnostics', ['device_uuid' => $this->device->uuid]);

        $this->assertFalse($result['error']);
        $checks = collect($result['body']['data']['checks'])->keyBy('check');
        $this->assertSame('problem', $checks['last_reading']['status']);
        $this->assertSame('unknown', $checks['reading_quality']['status']);
        $this->assertSame('https://app.example.test/organizations/'.$this->acme->uuid.'/devices/'.$this->device->uuid, $result['body']['data']['portal_url']);
    }

    public function test_alerts_and_sites(): void
    {
        $user = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $workflow = Workflow::create(['organization_id' => $this->acme->id, 'name' => 'Boiler too hot', 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $user->id]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => $user->id, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a', 64), 'definition' => ['binding' => ['device_uuid' => $this->device->uuid]]]);
        Alert::create(['organization_id' => $this->acme->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()]);

        $alerts = $this->callTool($this->token, 'list_alerts', ['site_uuid' => $this->site->uuid]);
        $this->assertFalse($alerts['error']);
        $this->assertSame('Boiler too hot', $alerts['body']['data']['alerts'][0]['workflow']['name']);
        $this->assertSame('Boiler room sensor', $alerts['body']['data']['alerts'][0]['device']['name']);
        $this->assertSame('active', $alerts['body']['data']['alerts'][0]['condition']);
        $empty = $this->callTool($this->token, 'list_alerts', ['site_uuid' => Site::create(['organization_id' => $this->acme->id, 'name' => 'Empty', 'timezone' => 'UTC'])->uuid]);
        $this->assertSame([], $empty['body']['data']['alerts']);

        $sites = collect($this->callTool($this->token, 'list_sites')['body']['data']['sites'])->keyBy('name');
        $this->assertSame(1, $sites['North plant']['devices_count']);
        $this->assertSame('America/Toronto', $sites['North plant']['timezone']);
    }
}
