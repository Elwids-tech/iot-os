<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Connectivity;

use App\Domain\Automation\Jobs\DeliverAlertEmail;
use App\Domain\Automation\Models\Alert;
use App\Domain\Connectivity\Services\ConnectivitySettings;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Support\Contracts\ContractMode;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\AssertsContracts;
use Tests\Support\ContractCase;
use Tests\TestCase;

/**
 * Device offline alerts in the control plane (spec 018 pull request 2): the runtime's
 * device.connectivity.v1 projected into alerts, the event log and the audit trail with
 * nothing sent; the offline-alert settings in the internal.control-state.v1 snapshot;
 * and the device.connectivity-settings.v1 message pull request 3 starts sending.
 */
final class ConnectivityProjectionTest extends TestCase
{
    use AssertsContracts;
    use RefreshDatabase;

    private const EVENT = 'device.connectivity.v1';

    private const SETTINGS = 'device.connectivity-settings.v1';

    private const STATE = 'internal.control-state.v1';

    private const TOKEN = 'connectivity-projection-runtime-token-0000';

    private Organization $org;

    private User $actor;

    private string $base;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        $this->base = '/api/v1/organizations/'.$this->org->uuid;
        config(['devices.runtime_token' => self::TOKEN, 'devices.runtime_url' => 'http://runtime:8081']);
        Mail::fake();
        Queue::fake();
    }

    private function device(string $code, ?Organization $organization = null): Device
    {
        return Device::create(['organization_id' => ($organization ?? $this->org)->id, 'name' => 'Box '.$code, 'code' => $code, 'lifecycle' => 'active', 'deployment_status' => 'applied', 'deployment_generation' => 1, 'applied_generation' => 1]);
    }

    private function gateway(string $edge, ?Organization $organization = null): SparkplugGateway
    {
        $organization ??= $this->org;
        $connection = SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Plant broker '.$edge, 'group_id' => 'plant-'.$edge, 'host_id' => 'host-'.$edge, 'username' => 'user-'.$edge, 'password' => 'secret', 'status' => 'ready']);

        return SparkplugGateway::create(['organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Gateway '.$edge, 'edge_node_id' => $edge]);
    }

    /** @return array{kind: string, device_uuid: ?string, connection_uuid: ?string, edge_node_id: ?string, adapter_uuid: ?string} */
    private function deviceSubject(Device $device): array
    {
        return ['kind' => 'device', 'device_uuid' => $device->uuid, 'connection_uuid' => null, 'edge_node_id' => null, 'adapter_uuid' => null];
    }

    private function gatewaySubject(SparkplugGateway $gateway): array
    {
        return ['kind' => 'gateway', 'device_uuid' => null, 'connection_uuid' => $gateway->connection->uuid, 'edge_node_id' => $gateway->edge_node_id, 'adapter_uuid' => null];
    }

    /**
     * A transition as the runtime writes it.
     *
     * @param  list<Device>  $devices
     */
    private function payload(array $subject, array $devices, string $transition = 'opened', int $episode = 1, array $changes = []): array
    {
        return [
            'organization_uuid' => $this->org->uuid, 'subject' => $subject, 'episode' => $episode, 'transition' => $transition,
            'cause' => 'missed_check_in', 'offline_since' => '2026-11-06T10:00:00Z', 'at' => $transition === 'opened' ? '2026-11-06T10:02:00Z' : '2026-11-06T10:30:00Z',
            'last_heard_at' => '2026-11-06T09:45:00Z', 'last_observed_at' => '2026-11-06T09:44:58Z',
            'offline_after_seconds' => 900, 'offline_after_automatic' => true, 'reporting_interval_seconds' => 120, 'poll_interval_seconds' => 300,
            'grace_seconds' => 120, 'settings_generation' => 0,
            'affected_device_uuids' => array_map(fn (Device $device) => $device->uuid, $devices),
            'stop_reason' => $transition === 'stopped' ? 'device_deactivated' : null,
            ...$changes,
        ];
    }

    private function send(array $payload, ?string $uuid = null): TestResponse
    {
        $envelope = ['uuid' => $uuid ?? (string) Str::uuid(), 'type' => self::EVENT, 'payload' => $payload];
        // What these tests send is what the runtime may send.
        $this->assertProduced(self::EVENT, $envelope);

        return $this->withToken(self::TOKEN)->postJson('/api/internal/devices/events', $envelope);
    }

    private function alert(string $key): Alert
    {
        return Alert::where('episode_key', $key)->firstOrFail();
    }

    public function test_an_episode_opens_clears_and_stops_with_its_cause_times_and_threshold(): void
    {
        $device = $this->device('box-1');
        $this->send($this->payload($this->deviceSubject($device), [$device]))->assertOk()->assertExactJson(['ok' => true]);
        $alert = $this->alert('device:'.$device->uuid.'#1');
        $this->assertSame([Alert::DEVICE_OFFLINE, 'warning', 'missed_check_in', 900, true, 120, 300, 120], [$alert->kind, $alert->severity, $alert->cause, $alert->threshold_seconds, $alert->threshold_automatic, $alert->reporting_interval_seconds, $alert->poll_interval_seconds, $alert->grace_seconds]);
        $this->assertSame([$device->id], $alert->devices()->pluck('devices.id')->all());
        $this->assertSame('2026-11-06T10:02:00Z', $alert->activated_at->utc()->toIso8601ZuluString());
        $this->assertNull($alert->automation_workflow_id);

        $view = $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertOk()->json('data');
        $this->assertSame(['type' => 'device', 'uuid' => $device->uuid, 'name' => 'Box box-1'], $view['subject']);
        $this->assertSame(['active', 'device_offline', 'missed_check_in', 900, true, false, false, 0, null], [$view['condition'], $view['kind'], $view['cause'], $view['threshold_seconds'], $view['threshold_automatic'], $view['muted'], $view['held'], $view['held_count'], $view['workflow_uuid']]);
        $this->assertSame('2026-11-06T09:45:00.000000Z', $view['last_seen_at']);
        $this->assertSame('2026-11-06T09:44:58.000000Z', $view['last_observed_at']);
        $this->getJson($this->base.'/alerts?kind[]=device_offline')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $alert->uuid);
        $this->getJson($this->base.'/alerts?kind[]=workflow')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson($this->base.'/alerts?kind[]=nonsense')->assertUnprocessable();
        $this->getJson($this->base.'/alerts?device='.$device->uuid)->assertOk()->assertJsonPath('meta.total', 1);

        $this->send($this->payload($this->deviceSubject($device), [$device], 'cleared'))->assertOk();
        $alert->refresh();
        $this->assertSame('2026-11-06T10:30:00Z', $alert->cleared_at->utc()->toIso8601ZuluString());
        $this->assertNull($alert->stopped_reason);
        $this->getJson($this->base.'/alerts/'.$alert->uuid)->assertJsonPath('data.condition', 'cleared');

        $this->send($this->payload($this->deviceSubject($device), [$device], 'opened', 2, ['cause' => 'death_certificate']))->assertOk();
        $this->send($this->payload($this->deviceSubject($device), [$device], 'stopped', 2, ['cause' => 'death_certificate']))->assertOk();
        $stopped = $this->alert('device:'.$device->uuid.'#2');
        $this->assertSame(['death_certificate', 'device_deactivated'], [$stopped->cause, $stopped->stopped_reason]);
        $this->getJson($this->base.'/alerts/'.$stopped->uuid)->assertJsonPath('data.condition', 'cleared')->assertJsonPath('data.stopped_reason', 'device_deactivated');
        $this->getJson($this->base.'/alerts?condition=active')->assertJsonPath('meta.total', 0);

        // The event log has the connectivity source, and audit records name the transitions.
        $events = DB::table('notification_events')->where('source', 'connectivity')->orderBy('id')->get();
        $this->assertSame(['firing', 'resolved', 'firing', 'resolved'], $events->pluck('status')->all());
        $this->assertSame('Device offline: Box box-1', $events[0]->title);
        $this->assertStringContainsString('missed check-in', $events[0]->summary);
        $this->assertStringContainsString('device deactivated', $events[3]->summary);
        $this->assertSame([false, false, false, false], $events->map(fn ($event) => (bool) $event->active)->all());
        $this->getJson('/api/v1/notifications/events?source=connectivity')->assertOk()->assertJsonPath('meta.total', 4)->assertJsonPath('summary.sources.connectivity', 0);
        $this->assertSame(['alert.opened', 'alert.cleared', 'alert.opened', 'alert.stopped'], DB::table('activity_log')->whereIn('subject_uuid', [$alert->uuid, $stopped->uuid])->orderBy('id')->pluck('event')->all());
    }

    public function test_offline_alerts_notify_nobody(): void
    {
        $device = $this->device('box-1');
        $this->send($this->payload($this->deviceSubject($device), [$device]))->assertOk();
        $this->send($this->payload($this->deviceSubject($device), [$device], 'cleared'))->assertOk();
        // FR-018: no subscription and no route yet, so no delivery, bell notification or integration event.
        $this->assertSame(0, DB::table('automation_alert_deliveries')->count());
        $this->assertSame(0, DB::table('notifications')->count());
        $this->assertSame(0, DB::table('notification_email_deliveries')->count());
        $this->assertSame(0, DB::table('integration_events')->count());
        Queue::assertNotPushed(DeliverAlertEmail::class);
        Mail::assertNothingOutgoing();
        $this->getJson($this->base.'/alert-notifications/summary')->assertOk()->assertJsonPath('data.unread', 0);
    }

    public function test_replays_and_out_of_order_transitions_record_one_episode_with_its_true_times(): void
    {
        $device = $this->device('box-1');
        $opened = $this->payload($this->deviceSubject($device), [$device]);
        $uuid = (string) Str::uuid();
        $this->send($opened, $uuid)->assertOk();
        $this->send($opened, $uuid)->assertOk()->assertJsonPath('duplicate', true);
        // The same episode re-emitted under another envelope is still one alert.
        $this->send($opened)->assertOk();
        $this->assertSame(1, Alert::where('kind', Alert::DEVICE_OFFLINE)->count());
        $this->assertSame(1, DB::table('notification_events')->where('source', 'connectivity')->count());

        // A clear that arrives before its opening (the control plane was down): history only.
        $late = $this->payload($this->deviceSubject($device), [$device], 'cleared', 2, ['offline_since' => '2026-11-06T11:00:00Z']);
        $this->send($late)->assertOk();
        $history = $this->alert('device:'.$device->uuid.'#2');
        $this->assertSame('2026-11-06T11:00:00Z', $history->activated_at->utc()->toIso8601ZuluString());
        $this->assertNotNull($history->cleared_at);
        $this->assertNull($history->activation_transition_id);
        $this->assertSame([$device->id], $history->devices()->pluck('devices.id')->all());
        $this->send($this->payload($this->deviceSubject($device), [$device], 'opened', 2, ['offline_since' => '2026-11-06T11:00:00Z', 'at' => '2026-11-06T11:02:00Z']))->assertOk();
        $history->refresh();
        $this->assertSame('2026-11-06T11:02:00Z', $history->activated_at->utc()->toIso8601ZuluString());
        $this->assertNotNull($history->cleared_at);
        // A late opening never reopens the incident in the event log.
        $this->assertSame(['resolved'], DB::table('notification_events')->where('incident_key', hash('sha256', 'connectivity:'.$history->uuid))->pluck('status')->all());
        // A second clear of a closed episode changes nothing.
        $this->send($this->payload($this->deviceSubject($device), [$device], 'stopped', 2))->assertOk();
        $this->assertNull($history->fresh()->stopped_reason);
        $this->assertSame(2, Alert::where('kind', Alert::DEVICE_OFFLINE)->count());
    }

    public function test_a_gateway_episode_lists_its_devices_and_they_show_offline_because_of_it(): void
    {
        $gateway = $this->gateway('edge-7');
        $meter = $this->device('meter');
        $light = $this->device('light');
        $this->send($this->payload($this->gatewaySubject($gateway), [$meter, $light], changes: ['cause' => 'death_certificate', 'last_observed_at' => null]))->assertOk();
        $alert = $this->alert('gateway:'.$gateway->connection->uuid.'/edge-7#1');
        $this->assertSame([Alert::GATEWAY_OFFLINE, $gateway->id], [$alert->kind, $alert->subject_gateway_id]);
        $this->assertEqualsCanonicalizing([$meter->id, $light->id], $alert->devices()->pluck('devices.id')->all());
        $view = $this->getJson($this->base.'/alerts/'.$alert->uuid)->json('data');
        $this->assertSame(['type' => 'gateway', 'uuid' => $gateway->uuid, 'name' => 'Gateway edge-7'], $view['subject']);
        $this->assertSame(2, $view['devices_total']);
        $this->getJson($this->base.'/alerts?device='.$light->uuid)->assertJsonPath('meta.total', 1);

        $device = $this->getJson($this->base.'/devices/'.$meter->uuid)->assertOk()->json('data');
        $this->assertSame('offline', $device['presence']);
        $this->assertSame('Offline because gateway Gateway edge-7 is offline.', $device['diagnostic']);
        $this->assertSame(['uuid' => $alert->uuid, 'kind' => 'gateway_offline', 'cause' => 'death_certificate', 'since' => '2026-11-06T10:00:00.000000Z', 'subject' => $view['subject']], $device['offline_alert']);
        $this->getJson($this->base.'/gateways')->assertOk()->assertJsonPath('data.0.offline_alert.uuid', $alert->uuid);

        $this->send($this->payload($this->gatewaySubject($gateway), [$meter, $light], 'cleared', changes: ['cause' => 'death_certificate', 'last_observed_at' => null]))->assertOk();
        $this->assertNull($this->getJson($this->base.'/devices/'.$meter->uuid)->json('data.offline_alert'));
        $this->getJson($this->base.'/gateways')->assertJsonPath('data.0.offline_alert', null);
    }

    public function test_events_naming_another_organizations_subjects_change_nothing(): void
    {
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreign = $this->device('foreign', $other);
        $foreignGateway = $this->gateway('edge-9', $other);
        $mine = $this->device('mine');

        // Acme's stream naming Northstar's device, gateway or connection: unknown in Acme.
        $this->send($this->payload($this->deviceSubject($foreign), [$foreign]))->assertOk()->assertJsonPath('ignored', 'unknown_reference');
        $this->send($this->payload($this->gatewaySubject($foreignGateway), [$foreign]))->assertOk()->assertJsonPath('ignored', 'unknown_reference');
        $this->send($this->payload(['kind' => 'source', 'device_uuid' => null, 'connection_uuid' => null, 'edge_node_id' => null, 'adapter_uuid' => (string) Str::uuid()], [$mine]))->assertOk()->assertJsonPath('ignored', 'unknown_reference');
        $this->assertSame(0, Alert::where('kind', '!=', Alert::WORKFLOW)->count());

        // Acme's own episode never lists another organization's device.
        $this->send($this->payload($this->deviceSubject($mine), [$mine, $foreign]))->assertOk();
        $this->assertSame([$mine->id], $this->alert('device:'.$mine->uuid.'#1')->devices()->pluck('devices.id')->all());

        // Northstar's alert stays out of Acme's lists, filters and detail.
        $this->send([...$this->payload($this->deviceSubject($foreign), [$foreign]), 'organization_uuid' => $other->uuid])->assertOk();
        $theirs = $this->alert('device:'.$foreign->uuid.'#1');
        $this->assertSame($other->id, $theirs->organization_id);
        $this->getJson($this->base.'/alerts')->assertJsonPath('meta.total', 1);
        $this->getJson($this->base.'/alerts?device='.$foreign->uuid)->assertJsonPath('meta.total', 0);
        $this->getJson($this->base.'/alerts/'.$theirs->uuid)->assertNotFound();
        $this->getJson($this->base.'/devices?status[]=offline_alert')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $mine->uuid);
    }

    public function test_connectivity_alerts_are_acknowledged_assigned_and_commented_like_any_alert(): void
    {
        $device = $this->device('box-1');
        $this->send($this->payload($this->deviceSubject($device), [$device]))->assertOk();
        $alert = $this->alert('device:'.$device->uuid.'#1');
        $url = $this->base.'/alerts/'.$alert->uuid;
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();

        $this->postJson($url.'/acknowledge')->assertOk()->assertJsonPath('data.acknowledged_by_name', 'Platform Super Admin')->assertJsonPath('data.kind', 'device_offline');
        $this->putJson($url.'/assignee', ['user_id' => $member->id])->assertOk()->assertJsonPath('data.assignee.id', $member->id);
        $this->postJson($url.'/comments', ['uuid' => (string) Str::uuid(), 'body' => 'Breaker tripped; electrician on the way.'])->assertCreated();
        $this->getJson($url.'/comments')->assertOk()->assertJsonPath('meta.total', 1);
        $this->postJson($this->base.'/alerts/acknowledge', ['alert_uuids' => [$alert->uuid]])->assertOk()->assertJsonPath('data.acknowledged', 0);
        $this->getJson($url.'/deliveries')->assertOk()->assertJsonCount(0, 'data');

        // The same permissions as workflow alerts: members of another organization see nothing.
        $this->actingAs(User::where('email', 'northstar.admin@example.test')->firstOrFail(), 'sanctum');
        $this->getJson($url)->assertForbidden();
        $this->postJson($url.'/acknowledge')->assertForbidden();
    }

    public function test_the_state_snapshot_carries_each_devices_offline_alert_settings(): void
    {
        $direct = $this->device('direct');
        $this->applyConfiguration($direct);
        $polled = $this->device('tracker');
        $webhook = $this->device('webhook');
        $this->install($polled, ['type' => 'poll', 'interval_seconds' => 600]);
        $this->install($webhook, ['type' => 'webhook']);

        $snapshot = $this->withToken(self::TOKEN)->getJson('/api/internal/devices/state')->assertOk()->json();
        $this->assertProduced(self::STATE, $snapshot);
        $settings = collect($snapshot['devices'])->keyBy('uuid')->map(fn (array $device) => $device['connectivity']);
        $this->assertSame(['generation' => 0, 'enabled' => true, 'style' => 'stays_connected', 'offline_after_seconds' => null, 'poll_interval_seconds' => null, 'grace_seconds' => 120], $settings[$direct->uuid]);
        $this->assertSame(['generation' => 0, 'enabled' => true, 'style' => 'connects_to_report', 'offline_after_seconds' => null, 'poll_interval_seconds' => 600, 'grace_seconds' => 120], $settings[$polled->uuid]);
        $this->assertSame('connects_to_report', $settings[$webhook->uuid]['style']);
        $this->assertNull($settings[$webhook->uuid]['poll_interval_seconds']);

        // pull request 3 sends the same settings as device.connectivity-settings.v1.
        $message = app(ConnectivitySettings::class)->message($polled);
        $this->assertProduced(self::SETTINGS, ['uuid' => (string) Str::uuid(), 'type' => self::SETTINGS, 'payload' => $message]);
        $this->assertSame([$this->org->uuid, $polled->uuid, 'connects_to_report', 600], [$message['organization_uuid'], $message['device_uuid'], $message['style'], $message['poll_interval_seconds']]);
    }

    /**
     * Every example the contract accepts projects into an alert of its kind (the
     * consumer is tolerant: unknown fields are ignored).
     */
    #[DataProvider('connectivityCases')]
    public function test_the_consumer_projects_every_accepted_example(ContractCase $case): void
    {
        if (! $case->accepted(ContractMode::Tolerant)) {
            $this->addToAssertionCount(1);

            return;
        }
        $envelope = $case->data();
        $payload = $envelope['payload'];
        $device = $this->device('box-1');
        $payload['organization_uuid'] = $this->org->uuid;
        $payload['affected_device_uuids'] = [$device->uuid];
        $payload['subject'] = match ($payload['subject']['kind']) {
            'device' => $this->deviceSubject($device),
            'gateway' => $this->gatewaySubject($this->gateway('edge-7')),
            'source' => [...$payload['subject'], 'adapter_uuid' => $this->adapter()],
        };
        $this->withToken(self::TOKEN)->postJson('/api/internal/devices/events', [...$envelope, 'payload' => $payload])->assertOk()->assertExactJson(['ok' => true]);
        $alert = Alert::where('kind', '!=', Alert::WORKFLOW)->sole();
        $this->assertSame(['device' => Alert::DEVICE_OFFLINE, 'gateway' => Alert::GATEWAY_OFFLINE, 'source' => Alert::CONNECTION_LOST][$payload['subject']['kind']], $alert->kind);
        $this->assertSame($payload['transition'] !== 'opened', $alert->cleared_at !== null);
    }

    /** @return array<string, array{ContractCase}> */
    public static function connectivityCases(): array
    {
        return self::contractCases(self::EVENT);
    }

    private function applyConfiguration(Device $device): void
    {
        $profile = DeviceProfile::create(['organization_id' => $this->org->id, 'code' => 'meter', 'name' => 'Meter']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id]);
        $definition = json_decode((string) file_get_contents(self::contractsRoot().'/devices/v2/configuration.fixture.json'), true, 512, JSON_THROW_ON_ERROR);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => str_repeat('b', 64), 'definition' => [...$definition, 'device_uuid' => $device->uuid, 'organization_uuid' => $this->org->uuid], 'created_at' => now()]);
        $device->update(['applied_configuration_uuid' => $configuration->uuid, 'desired_configuration_uuid' => $configuration->uuid]);
    }

    private function adapter(array $source = ['type' => 'platform']): string
    {
        $uuid = (string) Str::uuid();
        DB::table('device_adapters')->insert(['uuid' => $uuid, 'organization_id' => $this->org->id, 'device_profile_artifact_id' => $this->artifact(), 'name' => 'Vendor API '.substr($uuid, 0, 4), 'code' => '', 'fixtures' => '[]', 'source' => json_encode($source), 'created_by' => $this->actor->id, 'created_at' => now(), 'updated_at' => now()]);

        return $uuid;
    }

    private function artifact(): int
    {
        $profile = DeviceProfile::firstOrCreate(['organization_id' => $this->org->id, 'code' => 'tracker'], ['name' => 'Tracker']);

        return DeviceProfileArtifact::firstOrCreate(['device_profile_id' => $profile->id, 'revision' => 1], ['definition' => [], 'definition_hash' => str_repeat('c', 64), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id])->id;
    }

    /** Feeds the device through a device adapter whose running revision has this source. */
    private function install(Device $device, array $source): void
    {
        $adapter = DB::table('device_adapters')->where('uuid', $this->adapter(['type' => 'platform']))->value('id');
        $revision = (string) Str::uuid();
        DB::table('device_adapter_revisions')->insert(['uuid' => $revision, 'device_adapter_id' => $adapter, 'revision' => 1, 'content_hash' => str_repeat('c', 64), 'definition' => json_encode(['source' => $source]), 'secret_snapshot' => '', 'created_by' => $this->actor->id, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('device_adapters')->where('id', $adapter)->update(['applied_revision_uuid' => $revision, 'status' => 'running']);
        $candidate = DB::table('device_adapter_candidates')->insertGetId(['uuid' => (string) Str::uuid(), 'organization_id' => $this->org->id, 'device_adapter_id' => $adapter, 'source_device_id' => 'unit-'.$device->code, 'sparkplug_device_id' => 'src-'.$device->code, 'preview' => '{}', 'last_seen_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('device_installations')->insert(['uuid' => (string) Str::uuid(), 'organization_id' => $this->org->id, 'device_id' => $device->id, 'device_adapter_candidate_id' => $candidate, 'adapter_revision_uuid' => $revision, 'manufacturer_serial' => 'unit-'.$device->code, 'started_at' => now(), 'created_by' => $this->actor->id, 'created_at' => now(), 'updated_at' => now()]);
    }
}
