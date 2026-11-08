<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Integrations;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Integrations\Models\WebhookDelivery;
use App\Domain\Integrations\Services\EventJournal;
use App\Domain\Integrations\Services\WebhookDestination;
use App\Domain\Integrations\Services\WebhookDispatch;
use App\Domain\Integrations\Services\WebhookTransport;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Grants by site (spec 030, US3): a device at a granted site is granted while it is
 * there, through every read, the feed and webhooks; a scope change and a site deletion
 * have the consequences of a list change; another organization cannot read through a
 * scope (constitution III).
 */
final class GrantScopeTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private Organization $other;

    private User $admin;

    private Site $hall;

    private Site $yard;

    private Site $foreignSite;

    /** @var list<Device> the three devices at the hall */
    private array $atHall;

    private Device $loose;

    private Device $foreign;

    private string $manage;

    private string $read;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->admin = User::where('is_super_admin', true)->firstOrFail();
        $this->hall = Site::create(['organization_id' => $this->org->id, 'name' => 'Packaging hall', 'timezone' => 'Asia/Colombo']);
        $this->yard = Site::create(['organization_id' => $this->org->id, 'name' => 'Yard', 'timezone' => 'UTC']);
        $this->foreignSite = Site::create(['organization_id' => $this->other->id, 'name' => 'Foreign plant', 'timezone' => 'UTC']);
        $this->atHall = array_map(fn (int $n) => Device::create(['organization_id' => $this->org->id, 'site_id' => $this->hall->id, 'code' => 'P-20'.$n, 'name' => 'Pump '.$n]), [1, 2, 3]);
        $this->loose = Device::create(['organization_id' => $this->org->id, 'code' => 'loose', 'name' => 'No site']);
        $this->foreign = Device::create(['organization_id' => $this->other->id, 'site_id' => $this->foreignSite->id, 'code' => 'foreign', 'name' => 'Foreign']);
        $this->manage = '/api/v1/organizations/'.$this->org->uuid.'/applications';
        $this->read = '/api/integration/v1/organizations/'.$this->org->uuid;
    }

    /** A person signs in with a session; an integration application presents its token. */
    private function api(User|string $actor, string $method, string $path, array $body = [])
    {
        Auth::forgetGuards();

        return $actor instanceof User
            ? $this->withoutToken()->actingAs($actor)->json($method, $path, $body)
            : $this->withToken($actor)->json($method, $path, $body);
    }

    private function scoped(array $sites, array $abilities = ['devices:read']): array
    {
        return $this->api($this->admin, 'POST', $this->manage, ['name' => 'Twin', 'site_uuids' => $sites, 'abilities' => $abilities])->assertCreated()->json('data');
    }

    private function token(array $app, ?array $abilities = null): string
    {
        return $this->api($this->admin, 'POST', $this->manage.'/'.$app['uuid'].'/token', ['revision' => $app['revision'], 'abilities' => $abilities ?? $app['abilities'], 'expires_in_days' => 1])->assertCreated()->json('data.token');
    }

    /** A workflow alert bound to the device, journalled as the feed and webhooks see it. */
    private function alert(Device $device): void
    {
        $workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Boundary '.$device->code, 'updated_by' => $this->admin->id, 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a', 64)]);
        $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => $this->admin->id, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a', 64), 'definition' => ['binding' => ['device_uuid' => $device->uuid]]]);
        $alert = Alert::create(['organization_id' => $this->org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => 1, 'activated_at' => now()]);
        DB::transaction(fn () => EventJournal::alert($alert, 'activated'));
    }

    private function allowReceiver(): void
    {
        config(['webhooks.allowed_hosts' => ['receiver.example.test']]);
        app()->instance(WebhookDestination::class, new class extends WebhookDestination
        {
            protected function resolve(string $host): array
            {
                return ['8.8.8.8'];
            }
        });
    }

    public function test_a_scope_is_saved_and_a_grant_is_one_list_or_the_other(): void
    {
        $app = $this->scoped([$this->hall->uuid]);
        $this->assertSame([$this->hall->uuid], $app['site_uuids']);
        $this->assertSame([], $app['device_uuids']);
        $this->assertSame([], $app['devices']);
        $this->assertSame('Packaging hall', $app['sites'][0]['name']);
        $this->api($this->admin, 'GET', $this->manage)->assertOk()->assertJsonPath('data.0.sites.0.uuid', $this->hall->uuid);
        // Both lists, neither list, more than 50 sites, a foreign site: all refused, the foreign one with the generic message.
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Both', 'abilities' => ['devices:read'], 'device_uuids' => [$this->loose->uuid], 'site_uuids' => [$this->hall->uuid]])->assertUnprocessable()->assertJsonValidationErrors('device_uuids');
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Neither', 'abilities' => ['devices:read'], 'device_uuids' => [], 'site_uuids' => []])->assertUnprocessable()->assertJsonValidationErrors('device_uuids');
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Neither', 'abilities' => ['devices:read']])->assertUnprocessable()->assertJsonValidationErrors('device_uuids');
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Too many', 'abilities' => ['devices:read'], 'site_uuids' => array_map(fn () => (string) Str::uuid(), range(1, 51))])->assertUnprocessable()->assertJsonValidationErrors('site_uuids');
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Foreign', 'abilities' => ['devices:read'], 'site_uuids' => [$this->foreignSite->uuid]])->assertUnprocessable()->assertJsonPath('message', 'Every site must belong to this organization.');
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Unknown', 'abilities' => ['devices:read'], 'site_uuids' => [(string) Str::uuid()]])->assertUnprocessable()->assertJsonPath('message', 'Every site must belong to this organization.');
        // The new abilities are accepted, up to ten of them.
        $ten = ['devices:read', 'alerts:read', 'events:read', 'telemetry:read', 'locations:read', 'geofences:read', 'geofences:manage', 'geofences:activate', 'entities:read', 'telemetry:stream'];
        $this->api($this->admin, 'POST', $this->manage, ['name' => 'Everything', 'abilities' => $ten, 'site_uuids' => [$this->hall->uuid]])->assertCreated()->assertJsonPath('data.abilities', $ten);
        // A scope becomes a list and back; the list grant keeps its shape.
        $listed = $this->api($this->admin, 'PUT', $this->manage.'/'.$app['uuid'], ['revision' => $app['revision'], 'name' => 'Twin', 'abilities' => ['devices:read'], 'device_uuids' => [$this->loose->uuid]])->assertOk()->json('data');
        $this->assertSame([$this->loose->uuid], $listed['device_uuids']);
        $this->assertSame([], $listed['site_uuids']);
        $this->assertSame([], $listed['sites']);
        $this->assertSame('No site', $listed['devices'][0]['name']);
        $this->api($this->admin, 'PUT', $this->manage.'/'.$app['uuid'], ['revision' => $listed['revision'], 'name' => 'Twin', 'abilities' => ['devices:read'], 'device_uuids' => [], 'site_uuids' => [$this->yard->uuid]])->assertOk()->assertJsonPath('data.site_uuids', [$this->yard->uuid])->assertJsonPath('data.device_uuids', []);
    }

    public function test_devices_at_a_granted_site_are_granted_while_they_are_there(): void
    {
        $app = $this->scoped([$this->hall->uuid], ['devices:read', 'telemetry:read']);
        $token = $this->token($app);
        [$first, $second, $third] = $this->atHall;
        $this->api($token, 'GET', $this->read.'/devices')->assertOk()->assertJsonPath('meta.total', 3)->assertJsonPath('data.*.uuid', [$first->uuid, $second->uuid, $third->uuid]);
        $this->api($token, 'GET', $this->read.'/devices/'.$first->uuid)->assertOk()->assertJsonPath('data.site.uuid', $this->hall->uuid)->assertJsonPath('data.site.timezone', 'Asia/Colombo');
        $this->api($token, 'GET', $this->read.'/devices/'.$this->loose->uuid)->assertNotFound();
        $this->api($token, 'GET', $this->read.'/devices/'.$this->foreign->uuid)->assertNotFound();
        $this->api($token, 'GET', $this->read.'/devices/'.$this->loose->uuid.'/telemetry/latest')->assertNotFound();
        $this->api($token, 'GET', $this->read.'/devices/'.$this->loose->uuid.'/location-bindings')->assertNotFound();
        // Registered later at the site: granted with no change to the application (SC-004).
        $fourth = Device::create(['organization_id' => $this->org->id, 'site_id' => $this->hall->id, 'code' => 'P-204', 'name' => 'Pump 4']);
        $this->api($token, 'GET', $this->read.'/devices/'.$fourth->uuid)->assertOk();
        $this->api($token, 'GET', $this->read.'/devices')->assertJsonPath('meta.total', 4);
        $this->assertSame(1, IntegrationApplication::where('uuid', $app['uuid'])->value('grant_revision'));
        // Moved out, or left without a site: refused as not found from the next request.
        $first->update(['site_id' => $this->yard->id]);
        $this->api($token, 'GET', $this->read.'/devices/'.$first->uuid)->assertNotFound();
        $second->update(['site_id' => null]);
        $this->api($token, 'GET', $this->read.'/devices/'.$second->uuid)->assertNotFound();
        $this->api($token, 'GET', $this->read.'/devices')->assertJsonPath('meta.total', 2);
        // Moved back in: granted again.
        $first->update(['site_id' => $this->hall->id]);
        $this->api($token, 'GET', $this->read.'/devices/'.$first->uuid)->assertOk();
        // The other organization is never reachable, and its own scoped application sees only its own devices.
        $this->api($token, 'GET', '/api/integration/v1/organizations/'.$this->other->uuid.'/devices')->assertNotFound();
        $foreignApp = IntegrationApplication::create(['organization_id' => $this->other->id, 'name' => 'Foreign twin', 'abilities' => ['devices:read'], 'device_uuids' => [], 'site_uuids' => [$this->foreignSite->uuid]]);
        $secret = Str::random(40);
        $foreignToken = $foreignApp->tokens()->create(['name' => 'test', 'token' => hash('sha256', $secret), 'abilities' => ['devices:read'], 'expires_at' => now()->addDay()])->id.'|'.$secret;
        $this->api($foreignToken, 'GET', '/api/integration/v1/organizations/'.$this->other->uuid.'/devices')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $this->foreign->uuid);
        $this->api($foreignToken, 'GET', '/api/integration/v1/organizations/'.$this->other->uuid.'/devices/'.$first->uuid)->assertNotFound();
        $this->api($foreignToken, 'GET', $this->read.'/devices')->assertNotFound();
        // A site of the other organization smuggled into a scope resolves to nothing.
        IntegrationApplication::where('uuid', $app['uuid'])->update(['site_uuids' => json_encode([$this->foreignSite->uuid])]);
        $this->api($token, 'GET', $this->read.'/devices')->assertOk()->assertJsonPath('meta.total', 0);
        $this->api($token, 'GET', $this->read.'/devices/'.$this->foreign->uuid)->assertNotFound();
    }

    public function test_the_feed_and_webhook_deliveries_follow_the_scope(): void
    {
        $this->allowReceiver();
        $app = $this->scoped([$this->hall->uuid], ['events:read', 'alerts:read']);
        $token = $this->token($app);
        $hook = $this->api($this->admin, 'PUT', $this->manage.'/'.$app['uuid'].'/webhook', ['revision' => 0, 'url' => 'https://receiver.example.test/events'])->assertOk()->json('data');
        [$first] = $this->atHall;
        $this->alert($first);
        $this->alert($this->loose);
        $page = $this->api($token, 'GET', $this->read.'/events')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.data.device_uuid', $first->uuid)->json();
        $this->api($token, 'GET', $this->read.'/alerts')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.device_uuid', $first->uuid);
        $transport = $this->mock(WebhookTransport::class);
        $transport->shouldReceive('send')->once()->withArgs(fn ($url, $target, $body) => json_decode($body, true)['data']['device_uuid'] === $first->uuid)->andReturn(204);
        $worker = app(WebhookDispatch::class);
        $worker->tick($hook['uuid'] ? DB::table('integration_webhooks')->where('uuid', $hook['uuid'])->value('id') : 0);
        $this->travel(2)->seconds();
        $worker->tick(DB::table('integration_webhooks')->where('uuid', $hook['uuid'])->value('id'));
        $this->assertDatabaseCount('integration_webhook_deliveries', 1);
        $this->assertSame('delivered', WebhookDelivery::firstOrFail()->status);
        // Moved out of the site: its later events are skipped by the feed and never delivered.
        $first->update(['site_id' => null]);
        $this->alert($first);
        $this->api($token, 'GET', $this->read.'/events?cursor='.urlencode($page['next_cursor']))->assertOk()->assertJsonCount(0, 'data');
        $this->travel(2)->seconds();
        $transport->shouldNotReceive('send');
        $worker->tick(DB::table('integration_webhooks')->where('uuid', $hook['uuid'])->value('id'));
        $this->assertDatabaseCount('integration_webhook_deliveries', 1);
    }

    public function test_changing_the_scope_has_the_consequences_of_changing_the_list(): void
    {
        $this->allowReceiver();
        $app = $this->scoped([$this->hall->uuid], ['devices:read', 'events:read', 'alerts:read']);
        $token = $this->token($app);
        $this->api($this->admin, 'PUT', $this->manage.'/'.$app['uuid'].'/webhook', ['revision' => 0, 'url' => 'https://receiver.example.test/events'])->assertOk();
        $cursor = $this->api($token, 'GET', $this->read.'/events/checkpoint')->assertOk()->json('cursor');
        $app = $this->api($this->admin, 'GET', $this->manage)->json('data.0');
        $changed = $this->api($this->admin, 'PUT', $this->manage.'/'.$app['uuid'], ['revision' => $app['revision'], 'name' => 'Twin', 'abilities' => $app['abilities'], 'site_uuids' => [$this->hall->uuid, $this->yard->uuid]])->assertOk()->json('data');
        $this->assertSame($app['grant_revision'] + 1, $changed['grant_revision']);
        $this->assertSame(['Packaging hall', 'Yard'], array_column($changed['sites'], 'name'));
        $this->api($token, 'GET', $this->read.'/devices')->assertUnauthorized();
        $this->api($this->admin, 'GET', $this->manage.'/'.$app['uuid'].'/webhook')->assertOk()->assertJsonPath('data.enabled', false);
        $token = $this->token($changed);
        $this->api($token, 'GET', $this->read.'/events?cursor='.urlencode($cursor))->assertConflict();
        $this->assertDatabaseHas('activity_log', ['event' => 'application.grants_updated', 'subject_uuid' => $app['uuid']]);
    }

    public function test_a_deleted_site_leaves_every_scope_naming_it(): void
    {
        $this->allowReceiver();
        $app = $this->scoped([$this->hall->uuid, $this->yard->uuid], ['devices:read', 'events:read', 'alerts:read']);
        $untouched = $this->api($this->admin, 'POST', $this->manage, ['name' => 'List', 'device_uuids' => [$this->loose->uuid], 'abilities' => ['devices:read']])->assertCreated()->json('data');
        $token = $this->token($app);
        $this->api($this->admin, 'PUT', $this->manage.'/'.$app['uuid'].'/webhook', ['revision' => 0, 'url' => 'https://receiver.example.test/events'])->assertOk();
        $this->api($this->admin, 'DELETE', '/api/v1/organizations/'.$this->org->uuid.'/sites/'.$this->yard->uuid)->assertNoContent();
        $fresh = IntegrationApplication::where('uuid', $app['uuid'])->firstOrFail();
        $this->assertSame([$this->hall->uuid], $fresh->site_uuids);
        $this->assertSame(2, $fresh->grant_revision);
        // The token rotation bumped the revision once, the deletion once more.
        $this->assertSame(3, $fresh->revision);
        $this->api($token, 'GET', $this->read.'/devices')->assertUnauthorized();
        $this->api($this->admin, 'GET', $this->manage.'/'.$app['uuid'].'/webhook')->assertOk()->assertJsonPath('data.enabled', false);
        $audit = DB::table('activity_log')->where('event', 'application.grants_updated')->where('subject_uuid', $app['uuid'])->latest('id')->first();
        $this->assertNotNull($audit);
        $this->assertSame('site_deleted', json_decode($audit->properties, true)['reason']);
        $this->assertSame($this->yard->uuid, json_decode($audit->properties, true)['site_uuid']);
        $this->assertSame(1, IntegrationApplication::where('uuid', $untouched['uuid'])->value('grant_revision'));
        // The devices at the deleted site lost their site; the hall's devices stay granted to a new token.
        $this->assertNull($this->loose->fresh()->site_id);
        $this->api($this->token(array_replace($app, ['revision' => $fresh->revision])), 'GET', $this->read.'/devices')->assertOk()->assertJsonPath('meta.total', 3);
        // An emptied scope is kept, resolves to no device, and the manager sees why.
        $this->api($this->admin, 'DELETE', '/api/v1/organizations/'.$this->org->uuid.'/sites/'.$this->hall->uuid)->assertNoContent();
        $fresh->refresh();
        $this->assertSame([], $fresh->site_uuids);
        $this->assertSame(3, $fresh->grant_revision);
        $this->api($this->admin, 'GET', $this->manage)->assertOk()->assertJsonPath('data.0.site_uuids', [])->assertJsonPath('data.0.sites', [])->assertJsonPath('data.0.device_uuids', []);
        $this->api($this->token(array_replace($app, ['revision' => $fresh->revision])), 'GET', $this->read.'/devices')->assertOk()->assertJsonPath('meta.total', 0);
    }
}
