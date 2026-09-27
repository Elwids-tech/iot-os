<?php

namespace Tests\Feature;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Http\Middleware\OperationRequestLog;
use App\Support\DemoEnvironment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class DeploymentTest extends TestCase
{
    use RefreshDatabase;

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
