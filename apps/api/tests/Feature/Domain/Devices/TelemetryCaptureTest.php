<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\TelemetryDiagnosticAgent;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class TelemetryCaptureTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private string $prefix;

    private string $capture;

    private SparkplugGateway $gateway;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->org->uuid.'/telemetry-captures';
        $this->capture = (string) Str::uuid();
        $connection = SparkplugConnection::create(['organization_id' => $this->org->id, 'name' => 'Test', 'group_id' => 'group', 'host_id' => 'host', 'username' => 'hidden', 'password' => 'hidden', 'status' => 'ready']);
        $this->gateway = SparkplugGateway::create(['organization_id' => $this->org->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Gateway', 'edge_node_id' => 'edge']);
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
    }

    public function test_scope_is_resolved_server_side_and_audited(): void
    {
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => ['id' => $this->capture]])]);
        $this->postJson($this->prefix, ['gateway_uuid' => $this->gateway->uuid, 'duration_seconds' => 60, 'organization_uuid' => 'attacker', 'connection_uuid' => 'attacker'])->assertCreated();
        Http::assertSent(fn ($request) => $request['organization_uuid'] === $this->org->uuid && $request['connection_uuid'] === $this->gateway->connection->uuid && $request['source_device_id'] === null && is_int($request['user_id']));
        $this->assertDatabaseHas('activity_log', ['event' => 'telemetry.capture.started', 'subject_uuid' => $this->capture]);
    }

    public function test_cross_tenant_gateway_and_invalid_duration_never_reach_runtime(): void
    {
        Http::fake();
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-capture']);
        $this->gateway->update(['organization_id' => $other->id]);
        $this->postJson($this->prefix, ['gateway_uuid' => $this->gateway->uuid, 'duration_seconds' => 60])->assertNotFound();
        $this->postJson($this->prefix, ['gateway_uuid' => $this->gateway->uuid, 'duration_seconds' => 601])->assertUnprocessable();
        Http::assertNothingSent();
    }

    public function test_read_always_forwards_authorized_organization(): void
    {
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => ['id' => $this->capture]])]);
        $this->getJson($this->prefix.'/'.$this->capture.'?organization_uuid=attacker')->assertOk();
        Http::assertSent(fn ($request) => $request['organization_uuid'] === $this->org->uuid);
    }

    public function test_suspension_requires_explicit_confirmation(): void
    {
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => ['id' => $this->capture, 'scope' => [], 'suspended' => false]])]);
        $this->postJson($this->prefix.'/'.$this->capture, ['action' => 'suspend'])->assertUnprocessable();
        Http::assertNothingSent();
        $this->postJson($this->prefix.'/'.$this->capture, ['action' => 'suspend', 'confirm' => true])->assertOk();
        $this->assertDatabaseHas('activity_log', ['event' => 'telemetry.capture.suspend']);
        $this->postJson($this->prefix.'/'.$this->capture, ['action' => 'stop'])->assertOk();
        $this->postJson($this->prefix.'/'.$this->capture, ['action' => 'resume'])->assertOk();
    }

    public function test_unauthorized_user_cannot_read_or_start(): void
    {
        Http::fake();
        $user = User::factory()->create(['is_super_admin' => false]);
        $this->actingAs($user, 'sanctum');
        $this->getJson($this->prefix)->assertForbidden();
        $this->postJson($this->prefix, ['gateway_uuid' => $this->gateway->uuid, 'duration_seconds' => 60])->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_ai_is_grounded_in_selected_samples_and_has_no_write_tools(): void
    {
        config(['assistant.enabled' => true, 'ai.providers.openai.key' => 'test-only']);
        $sample = (string) Str::uuid();
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => ['samples' => [['id' => $sample, 'wire_base64' => 'private-wire-value', 'status' => 'decoded', 'metrics' => [['name' => 'temperature', 'value' => 0]]]]]])]);
        TelemetryDiagnosticAgent::fake([['explanation' => 'A received zero is a valid value.', 'evidence_ids' => [$sample, 'fabricated'], 'suggested_review' => '', 'next_check' => 'Inspect storage.']]);
        $this->postJson($this->prefix.'/'.$this->capture.'/diagnose', ['question' => 'Explain this sample', 'sample_ids' => [$sample]])->assertOk()->assertJsonPath('data.evidence_ids', [$sample])->assertJsonPath('data.changes_applied', false);
        TelemetryDiagnosticAgent::assertPrompted(fn ($prompt) => str_contains($prompt->prompt, $sample) && ! str_contains($prompt->prompt, 'private-wire-value'));
        $this->assertDatabaseHas('activity_log', ['event' => 'telemetry.capture.diagnosed']);
        $this->assertDatabaseHas('assistant_budgets', ['reserved_usd' => 0]);
    }

    public function test_evicted_samples_are_rejected_and_disabled_ai_does_not_call_provider(): void
    {
        TelemetryDiagnosticAgent::fake();
        $sample = (string) Str::uuid();
        Http::fake(['http://runtime:8081/*' => Http::response(['data' => ['samples' => [['id' => $sample]]]])]);
        $this->postJson($this->prefix.'/'.$this->capture.'/diagnose', ['question' => 'Explain', 'sample_ids' => [(string) Str::uuid()]])->assertUnprocessable();
        config(['assistant.enabled' => false]);
        $this->postJson($this->prefix.'/'.$this->capture.'/diagnose', ['question' => 'Explain', 'sample_ids' => [$sample]])->assertStatus(503);
        TelemetryDiagnosticAgent::assertNeverPrompted();
    }
}
