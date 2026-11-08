<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\DeviceLimit;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * Concurrent activations never take a billing account past its device limit (spec 029
 * FR-008, SC-003): claims lock the account row, so devices in different organizations
 * of one account serialize. A bulk onboarding run activates what fits and skips the rest
 * with the reason.
 */
final class DeviceLimitConcurrencyTest extends TestCase
{
    use ForksProcesses, RefreshDatabase;

    /**
     * 20 processes on their own connections each claim a place for their own device, in
     * two organizations of one account with one place left: exactly one gets it.
     */
    public function test_parallel_activations_at_the_last_place_let_exactly_one_through(): void
    {
        $this->skipUnlessForkable();
        $setup = $this->committedConnection();
        $now = now();
        $accountId = $setup->table('billing_accounts')->insertGetId(['uuid' => (string) Str::uuid(), 'name' => 'Concurrent devices', 'created_at' => $now, 'updated_at' => $now]);
        $organizations = [];
        foreach (['north', 'south'] as $name) {
            $organizations[] = $setup->table('organizations')->insertGetId(['uuid' => (string) Str::uuid(), 'name' => 'Concurrent '.$name, 'slug' => 'concurrent-'.$name.'-'.Str::lower(Str::random(6)), 'billing_account_id' => $accountId, 'created_at' => $now, 'updated_at' => $now]);
        }
        $setup->table('billing_allowance_overrides')->insert(['billing_account_id' => $accountId, 'kind' => 'devices', 'value' => 5, 'note' => 'Concurrency test', 'created_at' => $now, 'updated_at' => $now]);
        $device = fn (int $organization, string $code, bool $placed): int => $setup->table('devices')->insertGetId([
            'uuid' => (string) Str::uuid(), 'organization_id' => $organization, 'code' => $code, 'name' => $code,
            'limit_place_at' => $placed ? $now : null, 'created_at' => $now, 'updated_at' => $now,
        ]);
        foreach (range(1, 4) as $i) {
            $device($organizations[$i % 2], 'held-'.$i, true);
        }
        $contenders = array_map(fn (int $i): int => $device($organizations[$i % 2], 'contender-'.$i, false), range(0, 19));

        try {
            $outcomes = $this->inForkedProcesses(count($contenders), function (int $index, callable $ready) use ($contenders): string {
                $limit = app(DeviceLimit::class);
                $ready();

                try {
                    DB::transaction(function () use ($contenders, $index, $limit): void {
                        $limit->claim(Device::query()->lockForUpdate()->findOrFail($contenders[$index]));
                    });

                    return 'claimed';
                } catch (ValidationException) {
                    return 'refused';
                }
            });

            $counts = array_count_values($outcomes) + ['claimed' => 0, 'refused' => 0];
            ksort($counts);
            $this->assertSame(['claimed' => 1, 'refused' => 19], $counts);
            $this->assertSame(5, Device::query()->whereIn('organization_id', $organizations)->whereNotNull('limit_place_at')->count());
            $this->assertSame(5, (int) DB::table('billing_device_peaks')->where('billing_account_id', $accountId)->value('peak'));
        } finally {
            $setup->table('devices')->whereIn('organization_id', $organizations)->delete();
            foreach (['billing_device_peaks', 'billing_notices', 'billing_allowance_overrides'] as $table) {
                $setup->table($table)->where('billing_account_id', $accountId)->delete();
            }
            $setup->table('organizations')->whereIn('id', $organizations)->delete();
            $setup->table('billing_accounts')->where('id', $accountId)->delete();
            $setup->disconnect();
        }
    }

    public function test_a_bulk_onboarding_run_with_one_place_activates_one_keeps_the_rest_registered_and_a_retry_activates_them(): void
    {
        $this->seed(DatabaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $admin = User::where('email', 'super-admin@example.test')->firstOrFail();
        $this->actingAs($admin, 'sanctum');
        config(['devices.runtime_token' => str_repeat('t', 40), 'devices.runtime_url' => 'http://runtime:8081', 'devices.queue_connection' => 'sync']);
        Http::fake(['http://runtime:8081/*' => Http::response(['valid' => true])]);
        Artisan::call('devices:prepare-water-meter-profile');
        $artifact = DeviceProfile::where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $connection = SparkplugConnection::create(['organization_id' => $organization->id, 'name' => 'Plant broker', 'group_id' => 'plant', 'host_id' => 'plant-host', 'username' => 'plant-host', 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $organization->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Line 1 gateway', 'edge_node_id' => 'Line-1', 'username' => 'edge-line-1', 'password' => 'gateway-secret-value']);
        $ids = [];
        foreach (range(1, 5) as $i) {
            $ids[] = DiscoveryCandidate::create(['organization_id' => $organization->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => 'meter-00'.$i,
                'metrics' => [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 1.5], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 120.0]],
                'presence' => 'online', 'session_id' => 'session-test', 'birth_revision' => 1, 'last_seen_at' => now()])->source_device_id;
        }
        $held = app(DeviceLimit::class)->count($organization->billingAccount)['total'];
        app(Allowances::class)->override($organization->billingAccount, AllowanceKind::Devices, $held + 1, 'One place left', $admin);

        $run = $this->postJson('/api/v1/organizations/'.$organization->uuid.'/gateways/'.$gateway->uuid.'/bulk-onboardings', [
            'operation_uuid' => (string) Str::uuid(), 'artifact_uuid' => $artifact, 'name_pattern' => 'Meter {device_id}', 'source_device_ids' => $ids,
        ])->assertAccepted()->json('data');
        $run = $this->getJson('/api/v1/organizations/'.$organization->uuid.'/bulk-onboardings/'.$run['uuid'])->assertOk()->json('data');

        $this->assertSame([1, 4, 0], [$run['counts']['activation_requested'], $run['counts']['failed'], $run['counts']['skipped']]);
        $heldBack = collect($run['items'])->where('status', 'failed');
        $this->assertSame([DeviceLimit::refusal($held + 1)], $heldBack->pluck('reason')->unique()->values()->all());
        $this->assertSame($held + 1, app(DeviceLimit::class)->count($organization->billingAccount)['total']);
        // Each source beyond the limit stays registered with its device, not activated (spec 029 edge case).
        $devices = Device::where('organization_id', $organization->id)->where('code', 'like', 'line-1-meter-%')->get();
        $this->assertCount(5, $devices);
        $waiting = $devices->where('lifecycle', 'registered')->whereNull('desired_configuration_uuid');
        $this->assertSame($heldBack->pluck('device_uuid')->sort()->values()->all(), $waiting->pluck('uuid')->sort()->values()->all());

        // Once the limit is raised, the retry activates the same devices.
        app(Allowances::class)->override($organization->billingAccount, AllowanceKind::Devices, $held + 5, 'Raised', $admin);
        $this->postJson('/api/v1/organizations/'.$organization->uuid.'/bulk-onboardings/'.$run['uuid'].'/retry')->assertAccepted();
        $run = $this->getJson('/api/v1/organizations/'.$organization->uuid.'/bulk-onboardings/'.$run['uuid'])->assertOk()->json('data');
        $this->assertSame([5, 0], [$run['counts']['activation_requested'], $run['counts']['failed']]);
        $this->assertSame(5, Device::where('organization_id', $organization->id)->where('code', 'like', 'line-1-meter-%')->count());
        $this->assertSame($held + 5, app(DeviceLimit::class)->count($organization->billingAccount)['total']);
    }
}
