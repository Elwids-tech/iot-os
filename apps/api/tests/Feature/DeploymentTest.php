<?php

namespace Tests\Feature;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Http\Middleware\OperationRequestLog;
use App\Support\DemoEnvironment;
use App\Support\Operations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class DeploymentTest extends TestCase
{
    use RefreshDatabase;

    /**
     * On PostgreSQL the metrics also read the Go runtime's device_runtime schema, which the
     * runtime creates in production. Apply its real schema (idempotent) outside the test
     * transaction; migrate:fresh only drops the public schema.
     */
    protected function beforeRefreshingDatabase(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(file_get_contents(base_path('../../services/runtime/internal/storage/schema.sql')));
        }
    }

    public function test_stream_capacity_metrics_use_each_limit_and_only_fixed_stream_labels(): void
    {
        Http::fake(['*' => Http::response(['storage' => 99, 'account_details' => [['stream_detail' => [
            ['name' => 'IOT_DEVICE_TELEMETRY', 'state' => ['bytes' => 95], 'config' => ['max_bytes' => 100]],
            ['name' => 'untrusted-tenant-stream', 'state' => ['bytes' => 123], 'config' => ['max_bytes' => 456]],
        ]]]])]);
        $metrics = app(Operations::class)->metrics();
        $this->assertStringContainsString('iot_nats_stream_bytes{stream="IOT_DEVICE_TELEMETRY"} 95', $metrics);
        $this->assertStringContainsString('iot_nats_stream_limit_bytes{stream="IOT_DEVICE_TELEMETRY"} 100', $metrics);
        $this->assertStringNotContainsString('untrusted-tenant-stream', $metrics);
    }

    public function test_retired_consumers_do_not_mask_live_processing_health(): void
    {
        Http::fake(['*' => Http::response(['storage' => 99, 'config' => ['max_storage' => 1000], 'account_details' => [['stream_detail' => [
            ['name' => 'IOT_COMMITTED_TELEMETRY', 'consumer_detail' => [
                ['name' => 'workflow-evaluator-v1', 'num_pending' => 2, 'num_ack_pending' => 1],
                ['name' => 'retired-verification', 'num_pending' => 9000],
            ]],
        ]]]])]);
        $metrics = app(Operations::class)->metrics();
        $this->assertStringContainsString("iot_nats_consumer_pending 3\n", $metrics);
        $this->assertStringContainsString("iot_nats_unmanaged_consumer_pending 9000\n", $metrics);
        $this->assertStringContainsString("iot_nats_store_limit_bytes 1000\n", $metrics);
        $this->assertStringNotContainsString('retired-verification', $metrics);
    }

    public function test_expected_workers_report_never_started_and_recovered_heartbeats(): void
    {
        config(['deployment.expected_workers' => ['alerts', 'automation']]);
        Http::fake(['*' => Http::response(['storage' => 0])]);
        $metrics = app(Operations::class)->metrics();
        $this->assertStringContainsString('iot_worker_heartbeat_timestamp_seconds{worker="automation"} 0', $metrics);
        $this->assertStringNotContainsString('worker="scheduler"', $metrics);
        $this->assertStringContainsString('iot_automation_oldest_pending_seconds 0', $metrics);
        DB::table('operation_heartbeats')->insert(['name' => 'automation', 'seen_at' => 1700000000]);
        $this->assertStringContainsString('iot_worker_heartbeat_timestamp_seconds{worker="automation"} 1700000000', app(Operations::class)->metrics());
    }

    public function test_http_metrics_aggregate_status_and_skip_health_checks(): void
    {
        config(['deployment.ops_enabled' => true]);
        $middleware = new OperationRequestLog;
        foreach (['/api/example', '/api/example', '/up'] as $path) {
            $request = Request::create($path);
            $response = $middleware->handle($request, fn () => response('', 503));
            $middleware->terminate($request, $response);
        }
        $this->assertSame(2, (int) DB::table('operation_http_buckets')->sum('requests'));
        $this->assertDatabaseHas('operation_http_buckets', ['status_class' => 5]);
    }

    public function test_staging_bootstrap_refuses_production_even_when_flag_is_enabled(): void
    {
        $this->app->instance('env', 'production');
        config(['deployment.demo_enabled' => true]);
        $this->artisan('deployment:staging', ['--output' => sys_get_temp_dir().'/must-not-create.json'])->assertFailed();
        $this->assertDatabaseCount('users', 0);
        $this->assertFalse(DemoEnvironment::allowed());
    }

    public function test_bootstrap_preserves_passwords_edits_and_removed_memberships(): void
    {
        $this->app->instance('env', 'staging');
        config(['deployment.demo_enabled' => true]);
        $one = sys_get_temp_dir().'/staging-'.bin2hex(random_bytes(10)).'.json';
        $two = $one.'.second';
        try {
            $this->artisan('deployment:staging', ['--output' => $one])->assertSuccessful();
            $credentials = json_decode(file_get_contents($one), true, flags: JSON_THROW_ON_ERROR);
            $this->assertCount(7, $credentials);
            $this->assertSame(0600, fileperms($one) & 0777);
            $user = User::where('email', $credentials[1]['email'])->firstOrFail();
            $this->assertTrue(Hash::check($credentials[1]['password'], $user->password));
            $this->assertFalse(Hash::check('password', $user->password));
            $password = $user->password;
            $user->organizations()->detach();
            $org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
            $org->update(['name' => 'Tester edit']);
            $this->artisan('deployment:staging', ['--output' => $two])->assertSuccessful();
            $this->assertSame([], json_decode(file_get_contents($two), true));
            $this->assertSame($password, $user->fresh()->password);
            $this->assertSame(0, $user->organizations()->count());
            $this->assertSame('Tester edit', $org->fresh()->name);
            $this->artisan('deployment:staging', ['--output' => $one])->assertFailed();
        } finally {
            @unlink($one);
            @unlink($two);
        }
    }

    public function test_administrator_bootstrap_does_not_promote_existing_account(): void
    {
        User::factory()->create(['email' => 'existing@example.test']);
        $this->artisan('deployment:administrator', ['email' => 'existing@example.test', '--output' => '/tmp/no-write.json'])->assertFailed();
        $this->assertFalse((bool) User::first()->is_super_admin);
    }

    public function test_readiness_checks_runtime_and_metrics_require_a_secret(): void
    {
        config(['deployment.ops_enabled' => true, 'deployment.metrics_token' => str_repeat('a', 64)]);
        Http::fake(['*/health/ready' => Http::sequence()->push(['ok' => false], 503)->push(['ok' => true], 200)]);
        $this->getJson('/health/ready')->assertStatus(503)->assertExactJson(['ok' => false]);
        $this->get('/internal/ops/metrics')->assertForbidden();
        $this->withToken(str_repeat('b', 64))->get('/internal/ops/metrics')->assertForbidden();
        $this->withToken(str_repeat('a', 64))->get('/internal/ops/metrics')->assertOk()->assertSee('iot_queue_depth', false);
        $this->getJson('/health/ready')->assertOk();
    }
}
