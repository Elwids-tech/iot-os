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
}
