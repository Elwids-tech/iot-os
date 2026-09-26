<?php

declare(strict_types=1);
namespace Tests\Feature\Domain\Integrations;

use App\Domain\Automation\Models\{Alert, Deployment, Workflow};
use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\{Organization, User};
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{Auth, RateLimiter};
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

final class ApplicationTest extends TestCase
{
    use RefreshDatabase;
    private Organization $org;
    private Device $device;
    private string $admin;
    private string $manage;
    private string $read;
    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->device = Device::create(['organization_id' => $this->org->id, 'code' => 'sdk', 'name' => 'Test tag']);
        $this->admin = User::where('is_super_admin', true)->firstOrFail()->createToken('test')->plainTextToken;
        $this->manage = '/api/v1/organizations/'.$this->org->uuid.'/applications';
        $this->read = '/api/integration/v1/organizations/'.$this->org->uuid;
    }
    private function api(string $token, string $method, string $path, array $body = [])
    {
        Auth::forgetGuards();
        return $this->withToken($token)->json($method, $path, $body);
    }
    private function create(): array
    {
        return $this->api($this->admin, 'POST', $this->manage, ['name' => 'Cattle app', 'device_uuids' => [$this->device->uuid], 'abilities' => ['devices:read', 'alerts:read']])->assertCreated()->json('data');
    }
    private function token(array $app, array $abilities = ['devices:read', 'alerts:read']): array
    {
        return $this->api($this->admin, 'POST', $this->manage.'/'.$app['uuid'].'/token', ['revision' => $app['revision'], 'abilities' => $abilities, 'expires_in_days' => 1])->assertCreated()->json('data');
    }
    public function test_scopes_and_portal_separation(): void
    {
        $issued = $this->token($this->create());
        $this->device->update(['presence' => 'online', 'runtime_seen_at' => now()->subMinute()]);
        $this->api($issued['token'], 'GET', $this->read.'/devices/'.$this->device->uuid)->assertOk()->assertJsonPath('data.presence', 'unknown');
        $other = Device::create(['organization_id' => $this->org->id, 'code' => 'private', 'name' => 'Private tag']);
        $this->api($issued['token'], 'GET', $this->read.'/devices')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $this->device->uuid)->assertJsonMissingPath('data.0.draft');
        $this->api($issued['token'], 'GET', $this->read.'/devices/'.$other->uuid)->assertNotFound();
        $foreign = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->api($issued['token'], 'GET', '/api/integration/v1/organizations/'.$foreign->uuid.'/devices')->assertNotFound();
        $this->api($issued['token'], 'GET', '/api/v1/me')->assertUnauthorized();
        $this->api($issued['token'], 'GET', $this->manage)->assertUnauthorized();
        $this->api($this->admin, 'GET', $this->read.'/devices')->assertUnauthorized();
        $this->api($issued['token'], 'GET', $this->read.'/devices?per_page=101')->assertUnprocessable();
    }
    public function test_credential_lifecycle_and_ability_intersection(): void
    {
        $issued = $this->token($this->create());
        $new = $this->token($issued['application'], ['devices:read']);
        $this->api($issued['token'], 'GET', $this->read.'/devices')->assertUnauthorized();
        $this->api($new['token'], 'GET', $this->read.'/alerts')->assertForbidden();
        $this->api($this->admin, 'POST', $this->manage.'/'.$issued['application']['uuid'].'/token', ['revision' => 1, 'abilities' => ['devices:read'], 'expires_in_days' => 1])->assertConflict();
        $updated = $this->api($this->admin, 'PUT', $this->manage.'/'.$new['application']['uuid'], [...$new['application'], 'abilities' => ['alerts:read']])->assertOk()->json('data');
        $this->api($new['token'], 'GET', $this->read.'/devices')->assertUnauthorized();
        $next = $this->token($updated, ['alerts:read']);
        PersonalAccessToken::findToken($next['token'])->update(['expires_at' => now()->subSecond()]);
        $this->api($next['token'], 'GET', $this->read.'/alerts')->assertUnauthorized();
        $next = $this->token($next['application'], ['alerts:read']);
        $this->api($this->admin, 'POST', $this->manage.'/'.$updated['uuid'].'/revoke', ['revision' => $next['application']['revision']])->assertOk();
        $this->api($next['token'], 'GET', $this->read.'/alerts')->assertUnauthorized();
        $this->assertDatabaseHas('device_audit_events', ['action' => 'application.revoked', 'resource_uuid' => $updated['uuid']]);
    }
    public function test_alert_device_scope_and_minimal_contract(): void
    {
        $issued = $this->token($this->create());
        foreach ([$this->device->uuid, (string) \Illuminate\Support\Str::uuid()] as $device) {
            $workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Boundary', 'updated_by' => User::where('is_super_admin', true)->firstOrFail()->id, 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a', 64)]);
            $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => User::where('is_super_admin', true)->firstOrFail()->id, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a', 64), 'definition' => ['binding' => ['device_uuid' => $device]]]);
            Alert::create(['organization_id' => $this->org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()]);
        }
        $alert = $this->api($issued['token'], 'GET', $this->read.'/alerts')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.device_uuid', $this->device->uuid)->assertJsonMissingPath('data.0.acknowledged_by')->json('data.0');
        $this->api($issued['token'], 'GET', $this->read.'/alerts/'.$alert['uuid'])->assertOk();
        $this->api($issued['token'], 'GET', $this->read.'/alerts/'.Alert::latest('id')->first()->uuid)->assertNotFound();
        $this->api($issued['token'], 'GET', $this->read.'/alerts?condition=cleared')->assertJsonPath('meta.total', 0);
    }
    public function test_management_permissions_and_grant_validation(): void
    {
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $device = Device::create(['organization_id' => $other->id, 'code' => 'foreign', 'name' => 'Foreign']);
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Invalid', 'abilities' => ['devices:read'], 'device_uuids' => [$device->uuid]])->assertUnprocessable();
        $app = $this->create();
        $this->api($this->admin, 'POST', '/api/v1/organizations/'.$other->uuid.'/applications/'.$app['uuid'].'/revoke', ['revision' => 1])->assertNotFound();
        $this->api($this->admin, 'POST', $this->manage.'/'.$app['uuid'].'/token', ['revision' => 1, 'expires_in_days' => 91, 'abilities' => ['*']])->assertUnprocessable();
        $member = User::where('email', 'acme.member@example.test')->firstOrFail()->createToken('member')->plainTextToken;
        $this->api($member, 'POST', $this->manage, ['name' => 'Not allowed'])->assertForbidden();
    }
    public function test_rate_limit_survives_rotation(): void
    {
        $issued = $this->token($this->create());
        $key = 'integration-application:'.$issued['application']['uuid'];
        for ($i = 0; $i < 60; $i++) { RateLimiter::hit($key, 60); }
        $this->api($issued['token'], 'GET', $this->read.'/devices')->assertStatus(429)->assertHeader('Retry-After');
        $new = $this->token($issued['application']);
        $this->api($new['token'], 'GET', $this->read.'/devices')->assertStatus(429);
        RateLimiter::clear($key);
        $this->api($new['token'], 'GET', $this->read.'/devices')->assertOk();
    }

    public function test_telemetry_authority_projection_and_runtime_failure(): void
    {
        config(['devices.runtime_token' => 'test', 'devices.runtime_url' => 'http://runtime']);
        \Illuminate\Support\Facades\Http::fake(['*' => \Illuminate\Support\Facades\Http::sequence()->push([
            'data' => [['parameter_uuid' => $this->device->uuid, 'value' => null, 'quality' => 'stale', 'internal_secret' => 'hidden']],
            'presence' => 'offline', 'internal_secret' => 'hidden',
        ])->push([], 503)]);
        $app = $this->api($this->admin, 'POST', $this->manage, ['name' => 'Telemetry', 'device_uuids' => [$this->device->uuid], 'abilities' => ['telemetry:read']])->assertCreated()->json('data');
        $issued = $this->token($app, ['telemetry:read']);
        $path = $this->read.'/devices/'.$this->device->uuid.'/telemetry/latest';
        $this->api($issued['token'], 'GET', $path)->assertOk()->assertJsonPath('schema_version', 'telemetry-latest.v1')->assertJsonPath('data.0.value', null)->assertJsonMissing(['internal_secret' => 'hidden']);
        \Illuminate\Support\Facades\Http::assertSent(fn ($request) => $request['organization_uuid'] === $this->org->uuid && $request['device_uuid'] === $this->device->uuid);
        $this->api($this->admin, 'GET', $path)->assertUnauthorized();
        $this->api($issued['token'], 'GET', $this->read.'/devices/'.\Illuminate\Support\Str::uuid().'/telemetry/latest')->assertNotFound();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->api($issued['token'], 'GET', str_replace($this->org->uuid, $other->uuid, $path))->assertNotFound();
        $readOnly = $this->token($this->create());
        $this->api($readOnly['token'], 'GET', $path)->assertForbidden();
        $this->api($issued['token'], 'GET', $path)->assertStatus(503);
    }

    public function test_telemetry_history_bounds_and_empty_data(): void
    {
        config(['devices.runtime_token' => 'test', 'devices.runtime_url' => 'http://runtime']);
        \Illuminate\Support\Facades\Http::fake(['*' => \Illuminate\Support\Facades\Http::response(['data' => []])]);
        $app = $this->api($this->admin, 'POST', $this->manage, ['name' => 'Telemetry', 'device_uuids' => [$this->device->uuid], 'abilities' => ['telemetry:read']])->assertCreated()->json('data');
        $issued = $this->token($app, ['telemetry:read']);
        $path = $this->read.'/devices/'.$this->device->uuid.'/telemetry/history';
        $query = ['parameter_uuid' => $this->device->uuid, 'from' => '2026-09-01T00:00:00Z', 'to' => '2026-09-02T00:00:00Z'];
        $this->api($issued['token'], 'GET', $path.'?'.http_build_query($query))->assertOk()->assertJsonPath('data', [])->assertJsonPath('from', null);
        \Illuminate\Support\Facades\Http::assertSent(fn ($request) => $request['retention_days'] > 0 && $request['max_points'] === 500);
        foreach ([['to' => '2026-11-01T00:00:00Z'], ['from' => 'yesterday'], ['max_points' => 1001], ['to' => $query['from']]] as $invalid) {
            $this->api($issued['token'], 'GET', $path.'?'.http_build_query([...$query, ...$invalid]))->assertUnprocessable();
        }
    }

    public function test_raw_records_and_location_binding_scope(): void
    {
        config(['devices.runtime_token' => 'test', 'devices.runtime_url' => 'http://runtime']);
        \Illuminate\Support\Facades\Http::fake(['*' => \Illuminate\Support\Facades\Http::response(['data' => [], 'meta' => ['has_more' => false, 'next_cursor' => null], 'found' => true])]);
        $app = $this->api($this->admin, 'POST', $this->manage, ['name' => 'Raw telemetry', 'device_uuids' => [$this->device->uuid], 'abilities' => ['telemetry:read']])->assertCreated()->json('data');
        $issued = $this->token($app, ['telemetry:read']);
        $base = $this->read.'/devices/'.$this->device->uuid;
        $query = ['parameter_uuid' => $this->device->uuid, 'from' => '2026-09-01T00:00:00Z', 'to' => '2026-09-02T00:00:00Z', 'page_size' => 1, 'limit' => 2, 'cursor' => 'signed-cursor'];
        $this->api($issued['token'], 'GET', $base.'/telemetry/records?'.http_build_query($query))->assertOk()->assertJsonPath('schema_version', 'telemetry-records.v1');
        \Illuminate\Support\Facades\Http::assertSent(fn ($request) => $request['cursor'] === 'signed-cursor' && $request['device_uuid'] === $this->device->uuid && $request['organization_uuid'] === $this->org->uuid);
        foreach ([['page_size' => 101], ['limit' => 5001], ['cursor' => str_repeat('a', 513)]] as $invalid) {
            $this->api($issued['token'], 'GET', $base.'/telemetry/records?'.http_build_query([...$query, ...$invalid]))->assertUnprocessable();
        }
        $workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Location', 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a',64), 'updated_by' => User::where('is_super_admin', true)->firstOrFail()->id]);
        $version = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => $workflow->updated_by, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a',64), 'definition' => ['binding' => ['schema_version' => 'location-binding.v1', 'organization_uuid' => $this->org->uuid, 'device_uuid' => $this->device->uuid], 'private' => 'hidden']]);
        $this->api($issued['token'], 'GET', $base.'/location-bindings')->assertOk()->assertJsonPath('data.0.version_uuid', $version->uuid)->assertJsonMissing(['private' => 'hidden']);
        $this->api($issued['token'], 'GET', $base.'/locations/'.$this->device->uuid.'?version_uuid='.$version->uuid)->assertOk();
        $this->api($issued['token'], 'GET', $base.'/locations/'.$this->device->uuid.'?version_uuid='.\Illuminate\Support\Str::uuid())->assertNotFound();
        $workflow->update(['organization_id' => Organization::where('slug', 'northstar-utilities')->firstOrFail()->id]);
        $this->api($issued['token'], 'GET', $base.'/location-bindings')->assertOk()->assertJsonPath('data', []);
        $this->api($issued['token'], 'GET', $base.'/locations/'.$this->device->uuid.'?version_uuid='.$version->uuid)->assertNotFound();
    }
}
