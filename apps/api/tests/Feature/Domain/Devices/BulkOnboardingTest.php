<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Enums\BulkOnboardingStatus;
use App\Domain\Devices\Jobs\OnboardDiscoveredSources;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceBulkOnboarding;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\BulkOnboarding;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/** Bulk onboarding of discovered sources (spec 026 US5). */
final class BulkOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $prefix;

    private string $artifact;

    private SparkplugGateway $gateway;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        $this->prefix = '/api/v1/organizations/'.$this->organization->uuid;
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081', 'devices.queue_connection' => 'sync']);
        Http::fake(['http://runtime:8081/*' => Http::response(['valid' => true])]);
        Artisan::call('devices:prepare-water-meter-profile');
        $this->artifact = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $connection = SparkplugConnection::create(['organization_id' => $this->organization->id, 'name' => 'Plant broker', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'plant-host', 'password' => 'test-secret', 'status' => 'ready']);
        $this->gateway = SparkplugGateway::create(['organization_id' => $this->organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Line 1 gateway', 'edge_node_id' => 'Line-1', 'username' => 'edge-line-1', 'password' => 'gateway-secret-value']);
    }

    /** Meters `meter-001`… that announce what the water meter profile needs. */
    private function sources(int $count, string $prefix = 'meter-'): array
    {
        $ids = [];
        for ($i = 1; $i <= $count; $i++) {
            $ids[] = $this->source($prefix.str_pad((string) $i, 3, '0', STR_PAD_LEFT))->source_device_id;
        }

        return $ids;
    }

    private function source(string $id, ?array $metrics = null): DiscoveryCandidate
    {
        return DiscoveryCandidate::create(['organization_id' => $this->organization->id, 'sparkplug_gateway_id' => $this->gateway->id, 'source_device_id' => $id,
            'metrics' => $metrics ?? [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 1.5], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 120.0]],
            'presence' => 'online', 'session_id' => 'session-test', 'birth_revision' => 1, 'last_seen_at' => now()]);
    }

    private function input(array $ids, array $overrides = []): array
    {
        return ['operation_uuid' => (string) Str::uuid(), 'artifact_uuid' => $this->artifact, 'name_pattern' => 'Meter {device_id}', 'source_device_ids' => $ids, ...$overrides];
    }

    private function start(array $input): array
    {
        return $this->postJson($this->prefix.'/gateways/'.$this->gateway->uuid.'/bulk-onboardings', $input)->assertAccepted()->json('data');
    }

    private function bulkRun(string $uuid): array
    {
        return $this->getJson($this->prefix.'/bulk-onboardings/'.$uuid)->assertOk()->json('data');
    }

    /** @return array<string, array{status: string, reason: string|null, device_uuid: string|null, attempts: int}> */
    private function items(string $uuid): array
    {
        $items = [];
        $cursor = null;
        do {
            $page = $this->getJson($this->prefix.'/bulk-onboardings/'.$uuid.($cursor ? '?cursor='.urlencode($cursor) : ''))->assertOk()->json('data');
            foreach ($page['items'] as $item) {
                $items[$item['source_device_id']] = $item;
            }
            $cursor = $page['next_cursor'];
        } while ($cursor);

        return $items;
    }

    public function test_a_run_works_through_every_chunk_with_generated_names_and_codes(): void
    {
        Queue::fake();
        $ids = $this->sources(247);
        $run = $this->start($this->input($ids));
        $this->assertSame('queued', $run['status']);
        $this->assertSame(['pending' => 247, 'activation_requested' => 0, 'skipped' => 0, 'failed' => 0, 'active' => 0], $run['counts']);
        // Each job handles at most 50 items and hands the rest to the next one.
        $jobs = 0;
        while ($job = Queue::pushed(OnboardDiscoveredSources::class)->values()->get($jobs)) {
            $job->handle(app(BulkOnboarding::class));
            $jobs++;
        }
        $this->assertSame(5, $jobs);
        Queue::assertPushedOn('default', OnboardDiscoveredSources::class);
        $run = $this->bulkRun($run['uuid']);
        $this->assertSame('succeeded', $run['status']);
        $this->assertSame(247, $run['counts']['activation_requested']);
        $this->assertNotNull($run['finished_at']);
        $this->assertCount(100, $run['items']);
        $this->assertCount(247, $this->items($run['uuid']));
        $device = Device::where('code', 'line-1-meter-017')->firstOrFail();
        $this->assertSame('Meter meter-017', $device->name);
        $this->assertSame('pending', $device->deployment_status);
        $this->assertNotNull($device->desired_configuration_uuid);
        $this->assertSame(['flow_rate', 'total_volume'], array_column($device->configurations()->firstOrFail()->definition['mappings'], 'metric'));
        $this->assertSame(247, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->where('mode', 'gateway')->count());
        $this->assertSame(247, DB::table('device_outbox')->where('type', 'device.activate.v1')->count());
    }

    public function test_patterns_use_the_gateway_and_position_and_clashing_codes_get_a_suffix(): void
    {
        $ids = $this->sources(3);
        $actor = User::where('email', 'super-admin@example.test')->value('id');
        Device::create(['organization_id' => $this->organization->id, 'name' => 'Existing', 'code' => 'line-1-meter-002', 'created_by' => $actor, 'updated_by' => $actor]);
        $run = $this->start($this->input(array_reverse($ids), ['name_pattern' => '{gateway} #{n} ({device_id})']));
        $this->assertSame('succeeded', $this->bulkRun($run['uuid'])['status']);
        $this->assertSame('Line 1 gateway #1 (meter-001)', Device::where('code', 'line-1-meter-001')->value('name'));
        $this->assertSame('Line 1 gateway #2 (meter-002)', Device::where('code', 'line-1-meter-002-2')->value('name'));
        $this->assertSame('Existing', Device::where('code', 'line-1-meter-002')->value('name'));
    }

    public function test_sources_that_do_not_fit_are_skipped_with_their_reason_and_the_rest_continue(): void
    {
        [$good] = $this->sources(1);
        $this->source('missing', [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 1.0]]);
        $this->source('text', [['name' => 'Flow Rate', 'datatype' => 'String', 'value' => 'high'], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 1.0]]);
        $this->source('taken');
        $this->postJson($this->prefix.'/device-onboardings', ['request_uuid' => (string) Str::uuid(), 'name' => 'Taken', 'artifact_uuid' => $this->artifact, 'mode' => 'gateway', 'gateway_uuid' => $this->gateway->uuid, 'source_device_id' => 'taken'])->assertCreated();
        $run = $this->start($this->input([$good, 'missing', 'text', 'taken']));
        $items = $this->items($run['uuid']);
        $this->assertSame('activation_requested', $items[$good]['status']);
        $this->assertSame(['skipped', 'missing metric total_volume'], [$items['missing']['status'], $items['missing']['reason']]);
        $this->assertSame(['skipped', 'datatype String for number parameter flow_rate'], [$items['text']['status'], $items['text']['reason']]);
        $this->assertSame(['skipped', 'already onboarded'], [$items['taken']['status'], $items['taken']['reason']]);
        $this->assertNull($items['missing']['device_uuid']);
        $this->assertSame('partial_failure', $this->bulkRun($run['uuid'])['status']);
        // A skipped source leaves nothing behind.
        $this->assertSame(0, DeviceOnboarding::where('source_device_id', 'missing')->count());
        $this->assertSame(['line-1-meter-001'], Device::where('code', 'like', 'line-1-%')->pluck('code')->all());
    }

    public function test_the_same_operation_returns_the_run_and_a_different_request_conflicts(): void
    {
        $ids = $this->sources(3);
        $input = $this->input($ids);
        $first = $this->start($input);
        $again = $this->start([...$input, 'source_device_ids' => array_reverse($ids)]);
        $this->assertSame($first['uuid'], $again['uuid']);
        $this->assertSame(1, DeviceBulkOnboarding::count());
        $this->assertSame(3, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->count());
        $this->postJson($this->prefix.'/gateways/'.$this->gateway->uuid.'/bulk-onboardings', [...$input, 'name_pattern' => 'Other {device_id}'])->assertConflict();
        // A new run over the same sources creates no second device for any of them.
        $repeat = $this->start($this->input($ids));
        $this->assertSame('failed', $this->bulkRun($repeat['uuid'])['status']);
        $this->assertSame(['already onboarded'], array_values(array_unique(array_column($this->items($repeat['uuid']), 'reason'))));
        $this->assertSame(3, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->count());
    }

    public function test_a_duplicate_dispatch_onboards_no_source_twice(): void
    {
        Queue::fake();
        $run = $this->start($this->input($this->sources(60)));
        $model = DeviceBulkOnboarding::where('uuid', $run['uuid'])->firstOrFail();
        (new OnboardDiscoveredSources($model->id))->handle(app(BulkOnboarding::class));
        // The same first job delivered again finds the run running and does nothing.
        (new OnboardDiscoveredSources($model->id))->handle(app(BulkOnboarding::class));
        $this->assertSame(50, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->count());
        // An item claimed twice is onboarded once.
        $item = $model->items()->where('status', 'activation_requested')->firstOrFail();
        app(BulkOnboarding::class)->onboard($model, $item->id);
        $pending = $model->items()->where('status', 'pending')->orderBy('id')->firstOrFail();
        app(BulkOnboarding::class)->onboard($model, $pending->id);
        app(BulkOnboarding::class)->onboard($model, $pending->id);
        $this->assertSame(51, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->count());
        (new OnboardDiscoveredSources($model->id, true))->handle(app(BulkOnboarding::class));
        $this->assertSame(60, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->count());
        $this->assertSame(60, Device::whereIn('id', DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->select('device_id'))->distinct()->count());
        $this->assertSame('succeeded', $model->fresh()->status->value);
    }

    public function test_active_is_read_from_the_runtime_acknowledgement(): void
    {
        $run = $this->start($this->input($this->sources(2)));
        $this->assertSame(0, $this->bulkRun($run['uuid'])['counts']['active']);
        $device = Device::where('code', 'line-1-meter-001')->firstOrFail();
        $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => 'device.applied.v1', 'payload' => [
            'organization_uuid' => $this->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation,
            'configuration_uuid' => $device->desired_configuration_uuid, 'presence' => 'online',
        ]])->assertOk();
        $after = $this->bulkRun($run['uuid']);
        $this->assertSame(1, $after['counts']['active']);
        $this->assertSame(2, $after['counts']['activation_requested']);
        $items = collect($after['items'])->keyBy('source_device_id');
        $this->assertSame('active', $items['meter-001']['status']);
        $this->assertSame($device->uuid, $items['meter-001']['device_uuid']);
        $this->assertSame('activation_requested', $items['meter-002']['status']);
        // A refusal keeps the item requested and shows the runtime's reason.
        $refused = Device::where('code', 'line-1-meter-002')->firstOrFail();
        $refused->update(['deployment_status' => 'failed', 'diagnostic' => 'Metric total_volume is missing from the birth.']);
        $this->assertSame('Metric total_volume is missing from the birth.', collect($this->bulkRun($run['uuid'])['items'])->keyBy('source_device_id')['meter-002']['reason']);
    }

    public function test_the_run_status_rolls_up_from_its_items(): void
    {
        $this->assertSame(BulkOnboardingStatus::Running, BulkOnboarding::rollUp(['pending' => 1, 'activation_requested' => 3, 'skipped' => 0, 'failed' => 0]));
        $this->assertSame(BulkOnboardingStatus::Succeeded, BulkOnboarding::rollUp(['pending' => 0, 'activation_requested' => 3, 'skipped' => 0, 'failed' => 0]));
        $this->assertSame(BulkOnboardingStatus::PartialFailure, BulkOnboarding::rollUp(['pending' => 0, 'activation_requested' => 3, 'skipped' => 1, 'failed' => 0]));
        $this->assertSame(BulkOnboardingStatus::PartialFailure, BulkOnboarding::rollUp(['pending' => 0, 'activation_requested' => 1, 'skipped' => 0, 'failed' => 2]));
        $this->assertSame(BulkOnboardingStatus::Failed, BulkOnboarding::rollUp(['pending' => 0, 'activation_requested' => 0, 'skipped' => 2, 'failed' => 1]));
        $this->source('only-flow', [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 1.0]]);
        $run = $this->start($this->input(['only-flow']));
        $this->assertSame('failed', $this->bulkRun($run['uuid'])['status']);
    }

    public function test_retry_requeues_the_failed_items_only(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $runtimeDown = true;
        Http::swap(new Factory);
        Http::fake(function (HttpRequest $request) use (&$runtimeDown) {
            return $runtimeDown && str_contains($request->body(), '"device_id":"meter-002"') ? Http::response(['message' => 'Unavailable'], 503) : Http::response(['valid' => true]);
        });
        $ids = $this->sources(3);
        $this->source('missing', [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 1.0]]);
        $run = $this->start($this->input([...$ids, 'missing']));
        $items = $this->items($run['uuid']);
        $this->assertSame(['failed', 'The device runtime could not complete this request.', 0], [$items['meter-002']['status'], $items['meter-002']['reason'], $items['meter-002']['attempts']]);
        $this->assertSame('partial_failure', $this->bulkRun($run['uuid'])['status']);
        $this->assertSame(0, DeviceOnboarding::where('source_device_id', 'meter-002')->count());

        $runtimeDown = false;
        $retried = $this->postJson($this->prefix.'/bulk-onboardings/'.$run['uuid'].'/retry')->assertAccepted()->json('data');
        $this->assertSame($run['uuid'], $retried['uuid']);
        $items = $this->items($run['uuid']);
        $this->assertSame(['activation_requested', null, 1], [$items['meter-002']['status'], $items['meter-002']['reason'], $items['meter-002']['attempts']]);
        $this->assertSame(['skipped', 0], [$items['missing']['status'], $items['missing']['attempts']]);
        $this->assertSame(0, $items['meter-001']['attempts']);
        $this->assertSame(3, DeviceOnboarding::where('sparkplug_gateway_id', $this->gateway->id)->count());
        $this->assertSame('partial_failure', $this->bulkRun($run['uuid'])['status']);
        $this->postJson($this->prefix.'/bulk-onboardings/'.$run['uuid'].'/retry')->assertConflict();
        // A run still working cannot be retried.
        DeviceBulkOnboarding::where('uuid', $run['uuid'])->update(['status' => 'running']);
        $this->postJson($this->prefix.'/bulk-onboardings/'.$run['uuid'].'/retry')->assertConflict();
    }

    public function test_access_tenancy_and_limits(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $ids = $this->sources(2);
        $url = $this->prefix.'/gateways/'.$this->gateway->uuid.'/bulk-onboardings';
        $run = $this->start($this->input($ids));
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->postJson('/api/v1/organizations/'.$other->uuid.'/gateways/'.$this->gateway->uuid.'/bulk-onboardings', $this->input($ids))->assertNotFound();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/bulk-onboardings/'.$run['uuid'])->assertNotFound();
        $this->postJson('/api/v1/organizations/'.$other->uuid.'/bulk-onboardings/'.$run['uuid'].'/retry')->assertNotFound();

        $this->postJson($url, $this->input(array_map(fn ($i) => 'meter-'.$i, range(1, 501))))->assertUnprocessable()->assertJsonValidationErrors('source_device_ids');
        $this->postJson($url, $this->input(['']))->assertUnprocessable()->assertJsonValidationErrors('source_device_ids.0');
        $this->postJson($url, $this->input([$ids[0], $ids[0]]))->assertUnprocessable()->assertJsonValidationErrors('source_device_ids.0');
        $this->postJson($url, $this->input([$ids[0], 'unknown-meter']))->assertUnprocessable()->assertJsonValidationErrors('source_device_ids.1');
        $this->postJson($url, $this->input($ids, ['name_pattern' => 'Meter']))->assertUnprocessable()->assertJsonValidationErrors('name_pattern');
        $this->postJson($url, $this->input($ids, ['name_pattern' => '{device_id} {site}']))->assertUnprocessable()->assertJsonValidationErrors('name_pattern');
        $this->postJson($url, $this->input($ids, ['artifact_uuid' => (string) Str::uuid()]))->assertUnprocessable()->assertJsonValidationErrors('artifact_uuid');

        $this->actingAs(User::where('email', 'acme.member@example.test')->firstOrFail(), 'sanctum');
        $this->postJson($url, $this->input($ids))->assertForbidden();
        $this->postJson($this->prefix.'/bulk-onboardings/'.$run['uuid'].'/retry')->assertForbidden();
        $this->getJson($this->prefix.'/bulk-onboardings/'.$run['uuid'])->assertOk()->assertJsonPath('data.counts.activation_requested', 2);
    }

    public function test_the_activity_log_records_the_run_without_secrets(): void
    {
        $run = $this->start($this->input($this->sources(2)));
        $started = DB::table('activity_log')->where('event', 'device.bulk_onboarding.started')->firstOrFail();
        // PostgreSQL's jsonb does not keep key order, so compare without it.
        $this->assertEquals(['run_uuid' => $run['uuid'], 'profile_revision' => 1, 'count' => 2], json_decode($started->properties, true));
        $this->assertSame($this->gateway->uuid, $started->subject_uuid);
        $finished = DB::table('activity_log')->where('event', 'device.bulk_onboarding.finished')->firstOrFail();
        $this->assertSame('succeeded', json_decode($finished->properties, true)['status']);
        $this->assertSame(2, json_decode($finished->properties, true)['counts']['activation_requested']);
        $this->assertSame(2, DB::table('activity_log')->where('event', 'device.onboarding.started')->where('properties', 'like', '%'.$run['uuid'].'%')->count());
        $this->assertSame(2, DB::table('activity_log')->where('event', 'device.activation.requested')->count());
        foreach (DB::table('activity_log')->get() as $entry) {
            $this->assertStringNotContainsString('gateway-secret-value', json_encode($entry));
            $this->assertStringNotContainsString('test-secret', json_encode($entry));
        }
    }
}
