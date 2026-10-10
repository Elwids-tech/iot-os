<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class RuntimeStatusTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private string $url;

    /** Runtime /internal/status body; null simulates an unreachable runtime. */
    private ?array $status = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->url = '/api/v1/organizations/'.$this->org->uuid.'/runtime-status';
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::preventStrayRequests();
    }

    private function runtime(array $workflows, string $storage = 'ok', string $messaging = 'ok'): void
    {
        Cache::flush();
        $this->status = ['storage' => $storage, 'messaging' => $messaging, 'workflows' => $workflows, 'brokers' => ['connected' => 3, 'total' => 4]];
        Http::fake(fn () => $this->status === null ? throw new ConnectionException('refused') : Http::response($this->status));
    }

    public function test_members_see_a_tenant_safe_summary_of_partial_outages(): void
    {
        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->runtime(['state' => 'running', 'healthy' => true, 'fault' => null]);
        $this->getJson($this->url)->assertOk()
            ->assertJsonPath('data.state', 'operational')
            ->assertJsonPath('data.live_data', 'available')
            ->assertJsonPath('data.automations', 'running')
            ->assertJsonMissingPath('data.brokers');

        $this->runtime(['state' => 'paused', 'healthy' => false, 'fault' => ['code' => 'checkpoint_continuity', 'message' => 'internal detail', 'since' => '2026-10-09T10:12:40Z']]);
        $response = $this->getJson($this->url)->assertOk()
            ->assertJsonPath('data.state', 'degraded')
            ->assertJsonPath('data.live_data', 'available')
            ->assertJsonPath('data.automations', 'paused')
            ->assertJsonPath('data.automation_fault', 'checkpoint_continuity')
            ->assertJsonPath('data.since', '2026-10-09T10:12:40Z');
        $this->assertStringNotContainsString('internal detail', $response->getContent());

        $this->runtime(['state' => 'running', 'healthy' => true, 'fault' => null], messaging: 'disconnected');
        $this->getJson($this->url)->assertOk()->assertJsonPath('data.state', 'degraded')->assertJsonPath('data.live_data', 'unavailable');

        Cache::flush();
        $this->status = null;
        $this->getJson($this->url)->assertOk()->assertJsonPath('data.state', 'unavailable')->assertJsonPath('data.automations', 'unknown');
    }

    public function test_status_is_scoped_to_member_organizations(): void
    {
        $this->actingAs(User::where('email', 'northstar.member@example.test')->firstOrFail(), 'sanctum');
        $this->runtime(['state' => 'running', 'healthy' => true, 'fault' => null]);
        $this->getJson($this->url)->assertForbidden();
    }

    public function test_node_catalog_falls_back_to_the_last_copy_only_when_the_runtime_is_unavailable(): void
    {
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        $workflows = '/api/v1/organizations/'.$this->org->uuid.'/workflows';
        $this->putJson($workflows.'/dag/settings', ['enabled' => true, 'stopped' => false, 'revision' => 0])->assertOk();
        $available = true;
        Http::fake(function () use (&$available) {
            return $available ? Http::response([['type' => 'compare.v1', 'label' => 'Compare']]) : throw new ConnectionException('refused');
        });
        $this->getJson($workflows.'/dag/node-types')->assertOk()->assertJsonPath('data.0.label', 'Compare')->assertJsonMissingPath('meta');

        $available = false;
        $this->getJson($workflows.'/dag/node-types')->assertOk()
            ->assertJsonPath('data.0.type', 'compare.v1')
            ->assertJsonPath('meta.stale', true);

        Cache::flush();
        $this->getJson($workflows.'/dag/node-types')->assertStatus(503);
    }

    public function test_checkpoint_recovery_requires_a_lost_checkpoint_and_records_a_reason(): void
    {
        $workflows = ['state' => 'running', 'healthy' => true, 'fault' => null];
        Http::fake(function (Request $request) use (&$workflows) {
            return str_ends_with($request->url(), '/internal/status')
            ? Http::response(['storage' => 'ok', 'messaging' => 'ok', 'workflows' => $workflows])
            : Http::response(['previous' => ['stream_created' => '2026-10-03T05:06:46Z', 'sequence' => 693285], 'current' => ['stream_created' => '2026-10-09T10:00:00Z', 'first_sequence' => 1, 'sequence' => 120]]);
        });
        $this->artisan('devices:recover-workflow-checkpoint', ['--force' => true, '--reason' => 'drill'])
            ->expectsOutputToContain('no lost checkpoint')->assertSuccessful();
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), 'rebaseline'));

        $workflows = ['state' => 'paused', 'healthy' => false, 'fault' => ['code' => 'checkpoint_continuity', 'message' => 'workflow telemetry checkpoint lost continuity; recovery required', 'since' => '2026-10-09T10:12:40Z']];
        $this->artisan('devices:recover-workflow-checkpoint', ['--force' => true])
            ->expectsOutputToContain('reason of at least three characters')->assertFailed();
        $this->artisan('devices:recover-workflow-checkpoint')
            ->expectsQuestion('Reason for the incident record', 'NATS volume replaced')
            ->expectsConfirmation('Skip the unevaluated telemetry and resume workflow evaluation?', 'no')
            ->assertFailed();
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), 'rebaseline'));
        $this->artisan('devices:recover-workflow-checkpoint', ['--force' => true, '--reason' => 'NATS volume replaced'])
            ->expectsOutputToContain('resumes after stream sequence 120')->assertSuccessful();
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/internal/rules/checkpoint/rebaseline') && $request['reason'] === 'NATS volume replaced');
    }
}
