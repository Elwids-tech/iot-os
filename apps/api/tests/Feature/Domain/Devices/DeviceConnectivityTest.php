<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\Automation\Models\Alert;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * How devices show offline alerts and the runtime's connectivity state (spec 018 pull
 * request 2): the device page's connectivity, the list's `offline_alert` and status
 * filters, and adapter restarts and device review, which are never offline.
 */
final class DeviceConnectivityTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'device-connectivity-runtime-token-000000';

    private Organization $org;

    private User $actor;

    private string $base;

    /** What the fake runtime answers GET /internal/connectivity with; null fails the connection. */
    private ?array $runtime = ['devices' => []];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        $this->base = '/api/v1/organizations/'.$this->org->uuid;
        config(['devices.runtime_token' => self::TOKEN, 'devices.runtime_url' => 'http://runtime:8081']);
        Http::preventStrayRequests();
        Http::fake(['http://runtime:8081/internal/connectivity*' => fn () => $this->runtime === null ? Http::response(['message' => 'down'], 503) : Http::response($this->runtime)]);
    }

    private function device(string $code, ?Organization $organization = null, bool $configured = true): Device
    {
        $organization ??= $this->org;
        $device = Device::create(['organization_id' => $organization->id, 'name' => 'Box '.$code, 'code' => $code, 'lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => 1, 'applied_generation' => 1, 'presence' => 'online', 'runtime_seen_at' => now(), 'last_seen_at' => now()->subMinute()]);
        if ($configured) {
            $profile = DeviceProfile::firstOrCreate(['organization_id' => $organization->id, 'code' => 'box'], ['name' => 'Box']);
            $artifact = DeviceProfileArtifact::firstOrCreate(['device_profile_id' => $profile->id, 'revision' => 1], ['definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id]);
            $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64), 'definition' => ['mappings' => []], 'created_at' => now()]);
            $device->update(['applied_configuration_uuid' => $configuration->uuid, 'desired_configuration_uuid' => $configuration->uuid]);
        }

        return $device;
    }

    /** An open offline alert listing the devices, as ConnectivityProjector records it. */
    private function openAlert(string $kind, array $devices, array $values = []): Alert
    {
        $alert = Alert::create(['organization_id' => $devices[0]->organization_id, 'kind' => $kind, 'episode' => 1, 'episode_key' => 'device:'.Str::uuid().'#1', 'cause' => 'missed_check_in', 'offline_since' => '2026-11-06T10:00:00Z', 'activated_at' => '2026-11-06T10:02:00Z', ...$values]);
        $alert->devices()->attach(array_map(fn (Device $device) => $device->id, $devices));

        return $alert;
    }

    /** Feeds a device through a device adapter, polled every $poll seconds (or not polled). */
    private function install(Device $device, ?int $poll, string $status = 'running'): int
    {
        $row = fn (array $values) => [...$values, 'uuid' => (string) Str::uuid(), 'created_at' => now(), 'updated_at' => now()];
        $source = $poll === null ? ['type' => 'webhook'] : ['type' => 'poll', 'interval_seconds' => $poll];
        $artifact = DeviceProfileArtifact::firstOrFail()->id;
        $adapter = DB::table('device_adapters')->insertGetId($row(['organization_id' => $this->org->id, 'device_profile_artifact_id' => $artifact, 'name' => 'Vendor API', 'code' => '', 'fixtures' => '[]', 'source' => json_encode($source), 'status' => $status, 'created_by' => $this->actor->id]));
        $candidate = DB::table('device_adapter_candidates')->insertGetId($row(['organization_id' => $this->org->id, 'device_adapter_id' => $adapter, 'source_device_id' => 'unit-'.$device->code, 'sparkplug_device_id' => 'src-'.$device->code, 'preview' => '{}', 'last_seen_at' => now()]));
        DB::table('device_installations')->insert($row(['organization_id' => $this->org->id, 'device_id' => $device->id, 'device_adapter_candidate_id' => $candidate, 'adapter_revision_uuid' => (string) Str::uuid(), 'manufacturer_serial' => 'unit-'.$device->code, 'started_at' => now(), 'created_by' => $this->actor->id]));

        return $adapter;
    }

    private function reported(Device $device, array $values = []): array
    {
        return ['device_uuid' => $device->uuid, 'state' => 'monitored', 'monitoring_since' => '2026-11-06T09:00:00Z', 'last_heard_at' => '2026-11-06T09:58:00Z',
            'last_observed_at' => '2026-11-06T09:57:59Z', 'anchor_at' => '2026-11-06T09:00:00Z', 'reporting_interval_seconds' => 120, 'readings_counted' => 64,
            'poll_interval_seconds' => null, 'offline_after_seconds' => 900, 'offline_after_automatic' => true, 'suppressed_by_gateway' => false, 'interruption' => null, ...$values];
    }

    public function test_connectivity_shows_the_settings_in_effect_and_the_runtime_state(): void
    {
        $device = $this->device('box-1');
        $this->runtime = ['devices' => [$this->reported($device), ['device_uuid' => (string) Str::uuid(), 'state' => 'offline']]];
        $data = $this->getJson($this->base.'/devices/'.$device->uuid.'/connectivity')->assertOk()->json('data');
        $this->assertSame(['enabled' => true, 'style' => 'stays_connected', 'offline_after_seconds' => null, 'grace_seconds' => 120, 'severity' => 'warning', 'poll_interval_seconds' => null], $data['effective']);
        $this->assertSame(['enabled' => 'default', 'style' => 'default', 'offline_after_seconds' => 'automatic', 'grace_seconds' => 'default', 'severity' => 'default'], $data['inherited_from']);
        $this->assertNull($data['style_locked']);
        $this->assertNull($data['alert']);
        $this->assertSame([...$this->reported($device), 'before_monitoring' => false], ['device_uuid' => $device->uuid, ...$data['state']]);
        Http::assertSent(fn (Request $request) => str_contains($request->url(), '/internal/connectivity') && $request['organization'] === $this->org->uuid && $request['devices'] === $device->uuid);

        // A device last heard before monitoring began.
        $this->runtime = ['devices' => [$this->reported($device, ['state' => 'waiting', 'monitoring_since' => now()->toIso8601ZuluString(), 'last_heard_at' => null, 'reporting_interval_seconds' => null, 'readings_counted' => 0, 'offline_after_seconds' => null])]];
        $this->getJson($this->base.'/devices/'.$device->uuid.'/connectivity')->assertJsonPath('data.state.state', 'waiting')->assertJsonPath('data.state.before_monitoring', true);
    }

    public function test_an_adapter_device_connects_to_report_and_carries_its_poll_interval(): void
    {
        $device = $this->device('tracker');
        $this->install($device, 600);
        $this->runtime = ['devices' => [$this->reported($device, ['poll_interval_seconds' => 600, 'offline_after_seconds' => 960])]];
        $this->getJson($this->base.'/devices/'.$device->uuid.'/connectivity')->assertOk()
            ->assertJsonPath('data.effective.style', 'connects_to_report')->assertJsonPath('data.effective.poll_interval_seconds', 600)
            ->assertJsonPath('data.inherited_from.style', 'adapter')->assertJsonPath('data.style_locked', ['reason' => 'adapter'])
            ->assertJsonPath('data.state.offline_after_seconds', 960);
    }

    public function test_connectivity_is_unknown_without_the_runtime_and_inactive_without_asking_it(): void
    {
        $device = $this->device('box-1');
        $this->runtime = null;
        $this->getJson($this->base.'/devices/'.$device->uuid.'/connectivity')->assertOk()->assertJsonPath('data.state.state', 'unknown')->assertJsonPath('data.state.last_heard_at', null);
        // A device the runtime does not list is unknown too.
        $this->runtime = ['devices' => []];
        $this->getJson($this->base.'/devices/'.$device->uuid.'/connectivity')->assertJsonPath('data.state.state', 'unknown');

        $registered = $this->device('new', configured: false);
        $registered->update(['lifecycle' => 'registered', 'deployment_status' => 'idle']);
        $asked = count(Http::recorded());
        $this->getJson($this->base.'/devices/'.$registered->uuid.'/connectivity')->assertOk()->assertJsonPath('data.state.state', 'inactive');
        $this->assertCount($asked, Http::recorded(), 'an inactive device needs no runtime state');
    }

    public function test_another_organizations_device_is_not_found(): void
    {
        $foreign = $this->device('foreign', Organization::where('slug', 'northstar-utilities')->firstOrFail());
        $this->getJson($this->base.'/devices/'.$foreign->uuid.'/connectivity')->assertNotFound();
        $this->getJson($this->base.'/devices/'.Str::uuid().'/connectivity')->assertNotFound();
        $this->actingAs(User::where('email', 'northstar.admin@example.test')->firstOrFail(), 'sanctum');
        $this->getJson($this->base.'/devices/'.$this->device('mine')->uuid.'/connectivity')->assertForbidden();
    }

    public function test_an_open_offline_alert_shows_the_device_offline_in_the_list_and_its_filters(): void
    {
        // A silent sensor behind a live gateway still reports online; its alert decides (D14).
        $silent = $this->device('silent');
        $healthy = $this->device('healthy');
        $alert = $this->openAlert(Alert::DEVICE_OFFLINE, [$silent], ['subject_device_id' => $silent->id]);

        $rows = collect($this->getJson($this->base.'/devices?per_page=100')->assertOk()->json('data'))->keyBy('uuid');
        $this->assertSame(['offline', 'Offline: missed check-in.'], [$rows[$silent->uuid]['presence'], $rows[$silent->uuid]['diagnostic']]);
        $this->assertSame(['uuid' => $alert->uuid, 'kind' => 'device_offline', 'cause' => 'missed_check_in', 'since' => '2026-11-06T10:00:00.000000Z', 'subject' => ['type' => 'device', 'uuid' => $silent->uuid, 'name' => 'Box silent']], $rows[$silent->uuid]['offline_alert']);
        $this->assertSame(['online', null], [$rows[$healthy->uuid]['presence'], $rows[$healthy->uuid]['offline_alert']]);

        $uuids = fn (string $query) => collect($this->getJson($this->base.'/devices?'.$query)->assertOk()->json('data'))->pluck('uuid')->all();
        $this->assertSame([$silent->uuid], $uuids('status[]=offline_alert'));
        $this->assertContains($silent->uuid, $uuids('status[]=offline'));
        $this->assertNotContains($silent->uuid, $uuids('status[]=online'));
        $this->assertContains($healthy->uuid, $uuids('status[]=online'));
        $this->getJson($this->base.'/devices/'.$silent->uuid.'/connectivity')->assertJsonPath('data.alert.uuid', $alert->uuid);

        // A death certificate, and the alert's end.
        $alert->update(['cause' => 'death_certificate']);
        $this->getJson($this->base.'/devices/'.$silent->uuid)->assertJsonPath('data.diagnostic', 'Offline: death certificate.');
        $alert->update(['cleared_at' => now()]);
        $this->getJson($this->base.'/devices/'.$silent->uuid)->assertJsonPath('data.presence', 'online')->assertJsonPath('data.offline_alert', null);
        $this->assertSame([], $uuids('status[]=offline_alert'));
    }

    public function test_the_list_loads_offline_alerts_in_a_fixed_number_of_queries(): void
    {
        $queries = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson($this->base.'/devices?per_page=100')->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };
        $first = $this->device('box-1');
        $this->openAlert(Alert::DEVICE_OFFLINE, [$first], ['subject_device_id' => $first->id]);
        $few = $queries();
        foreach (range(2, 6) as $n) {
            $device = $this->device('box-'.$n);
            $this->openAlert(Alert::DEVICE_OFFLINE, [$device], ['subject_device_id' => $device->id]);
        }
        $this->assertSame($few, $queries());
    }

    public function test_an_adapter_restart_and_a_device_in_review_are_never_offline(): void
    {
        $tracker = $this->device('tracker');
        $adapter = $this->install($tracker, 300);
        $presence = fn (Device $device, string $presence, string $diagnostic) => $this->withToken(self::TOKEN)->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'device.presence.v1', 'payload' => [
            'organization_uuid' => $this->org->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $device->applied_configuration_uuid, 'generation' => 1, 'presence' => $presence, 'diagnostic' => $diagnostic]])->assertOk();

        // The runtime reports an adapter's death as unknown (spec 018, D3).
        $presence($tracker, 'unknown', DeviceView::ADAPTER_RESTARTING);
        $this->getJson($this->base.'/devices/'.$tracker->uuid)->assertJsonPath('data.presence', 'unknown')->assertJsonPath('data.diagnostic', DeviceView::ADAPTER_RESTARTING)->assertJsonPath('data.offline_alert', null);
        DB::table('device_adapters')->where('id', $adapter)->update(['status' => 'paused']);
        $this->getJson($this->base.'/devices/'.$tracker->uuid)->assertJsonPath('data.presence', 'unknown')->assertJsonPath('data.diagnostic', DeviceView::ADAPTER_PAUSED);
        $row = collect($this->getJson($this->base.'/devices?per_page=100')->json('data'))->firstWhere('uuid', $tracker->uuid);
        $this->assertSame(['unknown', DeviceView::ADAPTER_PAUSED], [$row['presence'], $row['diagnostic']]);

        // A birth that changed approved metrics needs review (ADR-025): the device still reports.
        $reviewed = $this->device('reviewed');
        $presence($reviewed, 'unknown', 'A source birth changed approved metrics. Review and activate a configuration to restore controls.');
        $this->getJson($this->base.'/devices/'.$reviewed->uuid)->assertJsonPath('data.presence', 'unknown');

        $offline = collect($this->getJson($this->base.'/devices?status[]=offline&status[]=offline_alert')->json('data'))->pluck('uuid');
        $this->assertNotContains($tracker->uuid, $offline);
        $this->assertNotContains($reviewed->uuid, $offline);
        $this->assertSame(0, Alert::where('kind', '!=', Alert::WORKFLOW)->count());
    }
}
