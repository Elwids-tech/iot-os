<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\DeviceLimit;
use App\Domain\Billing\Services\Usage;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Active devices count against the billing account's device limit (spec 029 US2,
 * FR-005 to FR-009, research R7): a device holds a place from the moment its activation
 * is accepted until its deactivation is accepted or it is archived, and activating or
 * reactivating at the limit is refused. Registering, editing drafts and reconfiguring an
 * active device never are, and nothing is ever deactivated by the limit.
 */
final class DeviceLimitTest extends TestCase
{
    use RefreshDatabase;

    private Organization $acme;

    private Organization $lakeside;

    private BillingAccount $account;

    private User $actor;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Queue::fake();
        $this->acme = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->account = $this->acme->billingAccount;
        $this->account->forceFill(['name' => 'Integrator Billing'])->save();
        $this->lakeside = Organization::factory()->forBillingAccount($this->account)->create(['name' => 'Lakeside Home']);
        $this->actor = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($this->actor, 'sanctum');
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081']);
        Http::fake(['http://runtime:8081/*' => Http::response(['valid' => true, 'session_id' => 'session-test', 'already_at_target' => false])]);
    }

    public function test_a_limit_of_three_across_two_organizations_refuses_the_fourth_activation_and_the_device_stays_registered(): void
    {
        $this->limit(3);
        $this->active($this->configured($this->acme, 'meter-1'));
        $this->active($this->configured($this->lakeside, 'meter-2'));
        // Accepted but not yet confirmed by the runtime: it already holds a place.
        $this->requestActivation($this->configured($this->acme, 'meter-3'))->assertAccepted();
        $fourth = $this->configured($this->lakeside, 'meter-4');

        $response = $this->requestActivation($fourth)
            ->assertUnprocessable()
            ->assertJsonPath('errors.device.0', "Your billing account's device limit (3) is reached. Deactivate a device or contact the platform operator.");

        foreach (['Integrator Billing', 'Acme Manufacturing', 'Lakeside Home', $this->account->uuid] as $hidden) {
            $this->assertStringNotContainsString($hidden, (string) $response->getContent());
        }
        $fourth->refresh();
        $this->assertSame(['registered', 'idle', null, null], [$fourth->lifecycle, $fourth->deployment_status, $fourth->desired_configuration_uuid, $fourth->limit_place_at]);
        $this->assertSame(0, DB::table('device_outbox')->where('type', 'device.activate.v1')->where('payload', 'like', '%'.$fourth->uuid.'%')->count());
        // Registering another device is never refused.
        $this->postJson($this->prefix($this->lakeside).'/devices', ['name' => 'Spare', 'code' => 'spare'])->assertCreated();

        $devices = $this->deviceUsage();
        $this->assertSame([3, 3, 0, false, 3], [$devices['count'], $devices['allowance'], $devices['left'], $devices['over_limit'], $devices['peak_this_month']]);
        $this->assertSame([
            ['organization_uuid' => $this->acme->uuid, 'name' => 'Acme Manufacturing', 'count' => 2],
            ['organization_uuid' => $this->lakeside->uuid, 'name' => 'Lakeside Home', 'count' => 1],
        ], $devices['organizations']);
    }

    public function test_deactivating_frees_a_place_and_reactivating_at_the_limit_is_refused(): void
    {
        $this->limit(2);
        $first = $this->active($this->configured($this->acme, 'meter-1'));
        $this->active($this->configured($this->acme, 'meter-2'));

        // The place is free once the deactivation is accepted, before the runtime confirms it.
        $this->postJson($this->url($first).'/deactivate', ['draft_revision' => $first->draft_revision])->assertAccepted();
        $this->assertNull($first->fresh()->limit_place_at);
        $this->active($this->configured($this->acme, 'meter-3'));
        $first->refresh();
        $this->runtimeEvent('device.deactivated.v1', ['organization_uuid' => $this->acme->uuid, 'device_uuid' => $first->uuid, 'generation' => $first->deployment_generation])->assertOk();
        $first->refresh();
        $this->assertSame('deactivated', $first->lifecycle);

        $this->postJson($this->url($first).'/lifecycle', ['operation_uuid' => (string) Str::uuid(), 'target_state' => 'active', 'expected_generation' => $first->deployment_generation])
            ->assertUnprocessable()
            ->assertJsonPath('errors.device.0', DeviceLimit::refusal(2));
        $this->assertSame('inactive', $first->fresh()->deployment_status);
        $this->assertSame(2, $this->deviceUsage()['count']);
    }

    public function test_reconfiguring_and_rolling_back_an_active_device_at_the_limit_succeed(): void
    {
        $this->limit(1);
        $device = $this->active($this->configured($this->acme, 'meter-1'));
        $first = $device->applied_configuration_uuid;

        $this->active($device);
        $device->refresh();
        $this->postJson($this->url($device).'/activate', ['draft_revision' => $device->draft_revision, 'rollback_configuration_uuid' => $first])->assertAccepted();

        $this->assertNotNull($device->fresh()->limit_place_at);
        $this->assertSame(1, $this->deviceUsage()['count']);
    }

    public function test_a_failed_first_activation_releases_its_place_and_a_failed_reconfiguration_or_deactivation_keeps_it(): void
    {
        $this->limit(5);
        $first = $this->configured($this->acme, 'meter-1');
        $this->requestActivation($first)->assertAccepted();
        $this->failInRuntime($first->fresh());
        $this->assertNull($first->fresh()->limit_place_at);
        $this->assertSame('registered', $first->fresh()->lifecycle);

        $reconfigured = $this->active($this->configured($this->acme, 'meter-2'));
        $this->requestActivation($reconfigured)->assertAccepted();
        $this->failInRuntime($reconfigured->fresh());
        $this->assertNotNull($reconfigured->fresh()->limit_place_at);

        $deactivated = $this->active($this->configured($this->acme, 'meter-3'));
        $this->postJson($this->url($deactivated).'/deactivate', ['draft_revision' => $deactivated->draft_revision])->assertAccepted();
        $this->assertNull($deactivated->fresh()->limit_place_at);
        // The runtime could not deactivate it, so it is still running and takes its place back.
        $this->failInRuntime($deactivated->fresh());
        $this->assertNotNull($deactivated->fresh()->limit_place_at);
        $this->assertSame(2, $this->deviceUsage()['count']);
    }

    public function test_archiving_releases_a_place(): void
    {
        $device = $this->active($this->configured($this->acme, 'meter-1'));
        $this->postJson($this->url($device).'/deactivate', ['draft_revision' => $device->draft_revision])->assertAccepted();
        $device->refresh();
        $this->runtimeEvent('device.deactivated.v1', ['organization_uuid' => $this->acme->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation])->assertOk();
        // A place left over from before the limit, which archiving still gives back.
        $device->refresh()->forceFill(['limit_place_at' => now()])->save();

        $this->postJson($this->url($device).'/archive', ['draft_revision' => $device->draft_revision])->assertOk();

        $this->assertNull($device->fresh()->limit_place_at);
    }

    public function test_lowering_the_limit_below_the_count_deactivates_nothing_and_refuses_activations(): void
    {
        $this->active($this->configured($this->acme, 'meter-1'));
        $this->active($this->configured($this->lakeside, 'meter-2'));
        $this->limit(1);

        $this->assertSame(2, Device::where('lifecycle', 'active')->whereNotNull('limit_place_at')->count());
        $devices = $this->deviceUsage();
        $this->assertSame([2, 1, 0, true], [$devices['count'], $devices['allowance'], $devices['left'], $devices['over_limit']]);
        $this->requestActivation($this->configured($this->acme, 'meter-3'))->assertUnprocessable();

        $manager = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $usage = $this->actingAs($manager, 'sanctum')->getJson('/api/v1/organizations/'.$this->acme->uuid.'/usage')->assertOk()->json('data');
        $this->assertSame(
            ['kind' => 'devices', 'month' => Usage::monthOf(CarbonImmutable::now()), 'count' => 1, 'allowance' => 1, 'left' => 0, 'overage' => 0, 'over_limit' => true],
            collect($usage)->firstWhere('kind', 'devices'),
        );
    }

    public function test_moving_an_organization_with_active_devices_into_a_full_account_deactivates_nothing(): void
    {
        $elsewhere = Organization::factory()->create(['name' => 'Harbour Works']);
        $this->active($this->configured($elsewhere, 'meter-1'));
        $this->active($this->configured($elsewhere, 'meter-2'));
        $this->active($this->configured($this->acme, 'meter-3'));
        $this->limit(2);

        $this->putJson('/api/v1/admin/organizations/'.$elsewhere->uuid.'/billing-account', ['billing_account_uuid' => $this->account->uuid])->assertNoContent();

        $this->assertSame(3, Device::where('lifecycle', 'active')->whereNotNull('limit_place_at')->count());
        $devices = $this->deviceUsage();
        $this->assertSame([3, true], [$devices['count'], $devices['over_limit']]);
        $this->requestActivation($this->configured($this->lakeside, 'meter-4'))->assertUnprocessable();
    }

    public function test_a_move_or_a_lower_limit_raises_the_peak_and_warns_without_an_activation(): void
    {
        $owner = User::factory()->create();
        $this->account->owners()->attach($owner->id, ['created_at' => now()]);
        $this->limit(10);
        $this->active($this->configured($this->acme, 'meter-1'));
        $elsewhere = Organization::factory()->create(['name' => 'Harbour Works']);
        foreach (range(2, 8) as $i) {
            $this->active($this->configured($elsewhere, 'meter-'.$i));
        }
        $month = now()->utc()->format('Y-m');
        $keys = fn (): array => DB::table('billing_notices')->where('billing_account_id', $this->account->id)->orderBy('key')->pluck('key')->all();
        $this->assertSame([], $keys());

        // Moving it in puts the account at 8 of 10: the peak and the 80% warning follow at once.
        $this->putJson('/api/v1/admin/organizations/'.$elsewhere->uuid.'/billing-account', ['billing_account_uuid' => $this->account->uuid])->assertNoContent();
        $this->assertSame(8, app(DeviceLimit::class)->peak($this->account, CarbonImmutable::now()));
        $this->assertSame(["devices:{$month}:80"], $keys());

        // Lowering the limit to 8 reaches it.
        $this->limit(8);
        $this->assertSame(["devices:{$month}:100", "devices:{$month}:80"], $keys());
    }

    public function test_a_limit_of_0_with_no_active_devices_sends_no_warning(): void
    {
        $this->account->owners()->attach(User::factory()->create()->id, ['created_at' => now()]);

        $this->limit(0);

        $this->assertSame(0, DB::table('billing_notices')->where('billing_account_id', $this->account->id)->count());
        // The first activation at 0 is refused, so 0 of 0 never warns.
        $this->requestActivation($this->configured($this->acme, 'meter-1'))->assertUnprocessable();
        $this->assertSame(0, DB::table('billing_notices')->where('billing_account_id', $this->account->id)->count());
    }

    public function test_the_months_peak_is_recorded_and_earlier_months_show_it(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-20 10:00:00', 'UTC'));
        $first = $this->active($this->configured($this->acme, 'meter-1'));
        $this->active($this->configured($this->acme, 'meter-2'));
        $this->postJson($this->url($first).'/deactivate', ['draft_revision' => $first->draft_revision])->assertAccepted();
        $this->assertSame(1, $this->deviceUsage()['count']);
        $this->assertSame(2, $this->deviceUsage()['peak_this_month']);

        // November starts with one device and nothing happening: the daily job records it.
        $this->travelTo(CarbonImmutable::parse('2026-11-01 00:15:00', 'UTC'));
        $this->artisan('billing:device-peaks')->assertSuccessful();

        $this->assertSame(1, app(DeviceLimit::class)->peak($this->account, CarbonImmutable::parse('2026-11-01', 'UTC')));
        $october = collect($this->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage?month=2026-10')->assertOk()->json('data'))->firstWhere('kind', 'devices');
        $this->assertSame([2, 2, [], null, false], [$october['count'], $october['peak_this_month'], $october['organizations'], $october['left'], $october['over_limit']]);
    }

    public function test_owners_are_warned_at_80_and_100_percent_once_a_month_and_the_list_finds_the_account(): void
    {
        $owner = User::factory()->create();
        $this->account->owners()->attach($owner->id, ['created_at' => now()]);
        $this->limit(5);
        foreach (range(1, 4) as $i) {
            $this->active($this->configured($this->acme, 'meter-'.$i));
        }
        $month = now()->utc()->format('Y-m');

        $this->assertSame(["devices:{$month}:80"], DB::table('billing_notices')->where('billing_account_id', $this->account->id)->pluck('key')->all());
        $this->assertSame([$this->account->uuid], array_column($this->getJson('/api/v1/admin/billing-accounts?usage_at_least=80')->assertOk()->json('data'), 'uuid'));

        $this->active($this->configured($this->acme, 'meter-5'));
        $device = Device::where('code', 'meter-5')->firstOrFail();
        $this->postJson($this->url($device).'/deactivate', ['draft_revision' => $device->draft_revision])->assertAccepted();
        $this->active($this->configured($this->acme, 'meter-6'));

        $this->assertSame(["devices:{$month}:100", "devices:{$month}:80"], DB::table('billing_notices')->where('billing_account_id', $this->account->id)->orderBy('key')->pluck('key')->all());
    }

    public function test_the_rollout_gives_places_to_active_devices_and_outstanding_activations(): void
    {
        $active = $this->active($this->configured($this->acme, 'meter-1'));
        $outstanding = $this->configured($this->acme, 'meter-2');
        $this->requestActivation($outstanding)->assertAccepted();
        $leaving = $this->active($this->configured($this->acme, 'meter-3'));
        $this->postJson($this->url($leaving).'/deactivate', ['draft_revision' => $leaving->draft_revision])->assertAccepted();
        $registered = $this->configured($this->acme, 'meter-4');

        $migration = require database_path('migrations/2026_11_08_000000_add_device_limit_places.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('devices', 'limit_place_at'));
        $migration->up();

        $this->assertSame(
            [true, true, false, false],
            array_map(fn (Device $device): bool => $device->fresh()->limit_place_at !== null, [$active, $outstanding, $leaving, $registered]),
        );
    }

    private function limit(int $devices): void
    {
        app(Allowances::class)->override($this->account, AllowanceKind::Devices, $devices, 'Test limit', $this->actor);
    }

    /**
     * @return array<string, mixed>
     */
    private function deviceUsage(): array
    {
        return collect($this->actingAs($this->actor, 'sanctum')->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage')->assertOk()->json('data'))
            ->firstWhere('kind', 'devices');
    }

    private function prefix(Organization $organization): string
    {
        return '/api/v1/organizations/'.$organization->uuid;
    }

    private function url(Device $device): string
    {
        return $this->prefix($device->organization).'/devices/'.$device->uuid;
    }

    /** A registered device with a saved draft on its own source, ready to activate. */
    private function configured(Organization $organization, string $code): Device
    {
        $uuid = $this->postJson($this->prefix($organization).'/devices', ['name' => 'Meter '.$code, 'code' => $code])->assertCreated()->json('data.uuid');
        $device = Device::where('uuid', $uuid)->firstOrFail();
        $definition = json_decode(file_get_contents(base_path('../../contracts/definitions/device-profiles/three-phase-energy-meter.v1.json')), true);
        $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => $code.'-profile', 'name' => 'Test profile']);
        $definition['profile']['uuid'] = $profile->uuid;
        $json = app(CanonicalJson::class)->encode($definition);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => hash('sha256', $json), 'status' => 'active', 'compiled_at' => now(), 'compiled_by' => $this->actor->id]);
        $connection = SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Connection '.$code, 'group_id' => $code, 'host_id' => $code, 'username' => $organization->slug.'-'.$code, 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Gateway', 'edge_node_id' => 'edge']);
        $metrics = [];
        $mappings = [];
        foreach ($definition['parameters'] as $parameter) {
            if (! $parameter['reports_state']) {
                continue;
            }
            $metrics[] = ['name' => $parameter['label'], 'datatype' => 'Double', 'value' => 230.0];
            $mappings[] = ['parameter_uuid' => $parameter['uuid'], 'metric' => $parameter['label'], 'command_metric' => $parameter['accepts_command'] ? $parameter['label'] : null];
        }
        $candidate = DiscoveryCandidate::create(['organization_id' => $organization->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => 'device', 'metrics' => $metrics, 'presence' => 'online', 'session_id' => 'session-test', 'birth_revision' => 1, 'last_seen_at' => now()]);
        $this->putJson($this->url($device).'/configuration', ['draft_revision' => 1, 'artifact_uuid' => $artifact->uuid, 'candidate_uuid' => $candidate->uuid, 'birth_revision' => 1, 'mappings' => $mappings])->assertOk();

        return $device->fresh();
    }

    private function requestActivation(Device $device): TestResponse
    {
        return $this->postJson($this->url($device).'/activate', ['draft_revision' => $device->fresh()->draft_revision]);
    }

    /** Activates the device, or applies a new configuration to an active one, and confirms it as the runtime would. */
    private function active(Device $device): Device
    {
        $this->requestActivation($device)->assertAccepted();
        $device->refresh();
        $this->runtimeEvent('device.applied.v1', ['organization_uuid' => $device->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'configuration_uuid' => $device->desired_configuration_uuid, 'presence' => 'online'])->assertOk();

        return $device->fresh();
    }

    private function failInRuntime(Device $device): void
    {
        $this->runtimeEvent('device.failed.v1', ['organization_uuid' => $device->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'diagnostic' => 'Rejected'])->assertOk();
    }

    private function runtimeEvent(string $type, array $payload): TestResponse
    {
        return $this->withToken(str_repeat('t', 40))->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => $type, 'payload' => $payload]);
    }
}
