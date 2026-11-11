<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Administration\Services\OrganizationDefaultRoles;
use App\Domain\Administration\Services\OrganizationRoleManager;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\DeviceAdapters\Models\AdapterCandidate;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceAdapters\Services\AdapterService;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Moves within a billing account (spec 031): organizations A and B share one account and
 * D a third seat on it, while C is on another. A holds a running adapter fed by the
 * simulated publisher; the runtime and the adapter manager are faked, and queued work
 * runs at once.
 */
abstract class MoveTestCase extends TestCase
{
    use RefreshDatabase;

    protected const RUNTIME_TOKEN = 'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr';

    protected Organization $a;

    protected Organization $b;

    protected Organization $c;

    protected Organization $d;

    protected User $mover;

    protected User $aOnly;

    protected User $bOnly;

    protected User $cAdmin;

    /** Bodies the adapter manager received at /deploy, in order. */
    protected array $deploys = [];

    /** The runtime requests Laravel made, by path. */
    protected array $runtime = [];

    /** The same requests with their query: [path, query]. */
    protected array $runtimeQueries = [];

    private ?DeviceAdapter $adapter = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->a = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->a->forceFill(['name' => 'Integrator'])->save();
        $this->b = Organization::factory()->forBillingAccount($this->a->billingAccount)->create(['name' => 'Harbour Shop']);
        $this->d = Organization::factory()->forBillingAccount($this->a->billingAccount)->create(['name' => 'Quay Store']);
        $this->c = Organization::factory()->create(['name' => 'Elsewhere Works']);
        foreach ([$this->b, $this->c, $this->d] as $organization) {
            app(OrganizationDefaultRoles::class)->ensure($organization);
        }
        $this->mover = $this->person('mover', [$this->a, $this->b, $this->d]);
        $this->aOnly = $this->person('a-only', [$this->a]);
        $this->bOnly = $this->person('b-only', [$this->b]);
        $this->cAdmin = $this->person('c-admin', [$this->c]);
        config(['devices.runtime_token' => self::RUNTIME_TOKEN, 'devices.runtime_url' => 'http://runtime.test', 'devices.broker_admin_token' => 'test-token',
            'devices.queue_connection' => 'sync', 'adapters.queue_connection' => 'sync', 'adapters.enabled' => true,
            'adapters.manager_url' => 'http://adapter-manager.test', 'adapters.manager_token' => str_repeat('m', 64)]);
        Http::fake(function (Request $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            if (str_starts_with($request->url(), 'http://runtime.test')) {
                $this->runtime[] = $path;
                parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
                $this->runtimeQueries[] = [$path, $query];
                if (($answer = $this->runtimeAnswer($path, $query)) !== null) {
                    return Http::response($answer);
                }

                return Http::response(match (true) {
                    str_ends_with($path, '/captures') => ['data' => []],
                    // A reading as the runtime stores it for an adapter-fed device.
                    str_ends_with($path, '/measurements/latest') => ['data' => [['parameter_uuid' => (string) Str::uuid(), 'key' => 'flow_rate', 'value' => 12.5, 'quality' => 'good',
                        'installation_uuid' => (string) Str::uuid(), 'adapter_revision_uuid' => 'pipe-owner-revision', 'manufacturer_serial' => 'WM-1001',
                        'observed_at' => now()->toJSON(), 'received_at' => now()->toJSON(), 'historical' => false]], 'presence' => 'online'],
                    default => ['valid' => true],
                });
            }
            if ($path === '/test') {
                return Http::response(['valid' => true, 'results' => [['passed' => true, 'output' => ['sourceDeviceId' => 'WM-1042', 'metrics' => [['name' => 'flow_rate', 'value' => 12], ['name' => 'total_volume', 'value' => 8400]]]]]]);
            }
            if ($path === '/deploy') {
                $this->deploys[] = $request->data();

                return Http::response(['applied' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']);
            }

            return Http::response(['connected' => true, 'broker_url' => 'mqtts://localhost:19000', 'ca_certificate' => 'public-test-ca']);
        });
        Artisan::call('devices:prepare-water-meter-profile');
        $this->actingAs($this->mover, 'sanctum');
    }

    /**
     * A test's own answer to a runtime request, before the fixture's; null leaves it to them.
     *
     * @param  array<string, mixed>  $query
     */
    protected function runtimeAnswer(string $path, array $query): ?array
    {
        return null;
    }

    /** @param list<Organization> $organizations Organization Admin in each */
    protected function person(string $name, array $organizations): User
    {
        $user = User::factory()->create(['name' => Str::title(str_replace('-', ' ', $name)), 'email' => $name.'@example.test']);
        foreach ($organizations as $organization) {
            $this->join($user, $organization, OrganizationRoleName::ORGANIZATION_ADMIN);
        }

        return $user;
    }

    protected function join(User $user, Organization $organization, OrganizationRoleName $role): void
    {
        $roles = app(OrganizationDefaultRoles::class)->ensure($organization);
        $user->organizations()->syncWithoutDetaching([$organization->id]);
        app(OrganizationRoleManager::class)->syncMemberRoles($organization, $user, [$roles[$role->value]->id]);
    }

    protected function in(Organization $organization): string
    {
        return '/api/v1/organizations/'.$organization->uuid;
    }

    /** A's running adapter, created, tested and deployed through the API. */
    protected function adapter(): DeviceAdapter
    {
        if ($this->adapter) {
            return $this->adapter->fresh();
        }
        $artifact = DeviceProfile::where('organization_id', $this->a->id)->where('code', 'water-meter-onboarding-example')->firstOrFail()->artifacts()->firstOrFail()->uuid;
        $uuid = $this->as($this->mover, fn () => $this->postJson($this->in($this->a).'/device-adapters', ['request_uuid' => (string) Str::uuid(), 'name' => 'Vendor meters', 'artifact_uuid' => $artifact,
            'source' => ['type' => 'platform', 'topics' => ['manufacturer/meters/+']],
            'code' => 'function decode(input){return {sourceDeviceId:input.payload.serial,metrics:[{name:"flow_rate",value:input.payload.flow},{name:"total_volume",value:input.payload.total}]}}',
            'fixtures' => [['topic' => 'manufacturer/meters/live', 'payload' => ['serial' => 'WM-1042', 'flow' => 12, 'total' => 8400]]]])->assertCreated()->json('data.uuid'));
        $this->as($this->mover, fn () => $this->postJson($this->in($this->a).'/device-adapters/'.$uuid.'/test', ['draft_revision' => 1])->assertOk());
        $adapter = DeviceAdapter::where('uuid', $uuid)->firstOrFail();
        $gateway = app(AdapterService::class)->gateway($adapter);
        $adapter->update(['status' => 'running', 'applied_revision_uuid' => $adapter->revisions()->firstOrFail()->uuid]);
        $gateway->update(['presence' => 'online', 'runtime_seen_at' => now()]);

        return $this->adapter = $adapter->fresh();
    }

    /** An adapter-fed device of A, activated through the adapter and applied by the runtime. */
    protected function adapterFed(string $serial, string $name, bool $active = true): Device
    {
        $adapter = $this->adapter();
        $source = 'src-'.substr(hash('sha256', $serial), 0, 32);
        DiscoveryCandidate::create(['organization_id' => $this->a->id, 'sparkplug_gateway_id' => $adapter->sparkplug_gateway_id, 'source_device_id' => $source, 'birth_revision' => 1,
            'presence' => 'online', 'session_id' => 'session-test', 'last_seen_at' => now(),
            'metrics' => [['name' => 'flow_rate', 'datatype' => 'Double', 'value' => 12], ['name' => 'total_volume', 'datatype' => 'Double', 'value' => 8400]]]);
        $candidate = AdapterCandidate::create(['organization_id' => $this->a->id, 'device_adapter_id' => $adapter->id, 'source_device_id' => $serial, 'sparkplug_device_id' => $source, 'preview' => [], 'last_seen_at' => now()]);
        $uuid = $this->as($this->mover, fn () => $this->postJson($this->in($this->a).'/device-adapters/'.$adapter->uuid.'/candidates/'.$candidate->uuid.'/activate', ['name' => $name])->assertAccepted()->json('data.device.uuid'));
        $device = Device::where('uuid', $uuid)->firstOrFail();
        $device->update(['code' => Str::slug($name)]);
        $this->applied($device);
        if (! $active) {
            $this->deactivated($device);
        }

        return $device->fresh();
    }

    /** A device of A with no source. */
    protected function unsourced(string $name, ?Organization $organization = null): Device
    {
        $organization ??= $this->a;

        return Device::where('uuid', $this->as($this->mover, fn () => $this->postJson($this->in($organization).'/devices', ['name' => $name, 'code' => Str::slug($name)])->assertCreated()->json('data.uuid')))->firstOrFail();
    }

    protected function applied(Device $device): void
    {
        $device->refresh();
        $this->runtimeEvent('device.applied.v1', ['organization_uuid' => $device->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'configuration_uuid' => $device->desired_configuration_uuid, 'presence' => 'online'])->assertOk();
    }

    protected function deactivated(Device $device): void
    {
        $device->refresh();
        $this->as($this->mover, fn () => $this->postJson($this->in($device->organization).'/devices/'.$device->uuid.'/deactivate', ['draft_revision' => $device->draft_revision])->assertAccepted());
        $device->refresh();
        $this->runtimeEvent('device.deactivated.v1', ['organization_uuid' => $device->organization->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation])->assertOk();
    }

    /** The runtime acknowledges, or refuses, every stop a move is waiting for. */
    protected function answerStops(bool $refuse = false): void
    {
        foreach (DeviceMoveDevice::where('state', 'stopping')->with('predecessor.organization')->get() as $row) {
            $device = $row->predecessor;
            $this->runtimeEvent($refuse ? 'device.failed.v1' : 'device.deactivated.v1', ['organization_uuid' => $device->organization->uuid, 'device_uuid' => $device->uuid,
                'generation' => $device->deployment_generation, 'operation_uuid' => $row->stop_operation_uuid, ...($refuse ? ['diagnostic' => 'The source is busy.'] : [])])->assertOk();
        }
    }

    protected function runtimeEvent(string $type, array $payload): TestResponse
    {
        $response = $this->withToken(self::RUNTIME_TOKEN)->postJson('/api/internal/devices/events', ['uuid' => (string) Str::uuid(), 'type' => $type, 'payload' => $payload]);
        $this->flushHeaders();

        return $response;
    }

    /**
     * @param  list<Device>  $devices
     * @param  array<string, mixed>  $extra
     */
    protected function review(Organization $source, Organization $target, array $devices, array $extra = []): TestResponse
    {
        return $this->postJson($this->in($source).'/device-moves/preview', ['target_organization_uuid' => $target->uuid, 'device_uuids' => array_map(fn (Device $device) => $device->uuid, $devices), ...$extra]);
    }

    /**
     * Reviews and confirms a move as the acting person.
     *
     * @param  list<Device>  $devices
     * @param  array<string, mixed>  $extra
     */
    protected function confirm(Organization $source, Organization $target, array $devices, array $extra = []): TestResponse
    {
        $hash = $this->review($source, $target, $devices, $extra)->assertOk()->json('preview_hash');

        return $this->postJson($this->in($source).'/device-moves', ['target_organization_uuid' => $target->uuid, 'device_uuids' => array_map(fn (Device $device) => $device->uuid, $devices),
            ...$extra, 'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $hash]);
    }

    /** Moves the devices and lets the runtime stop them, returning the completed move. */
    protected function moved(Organization $source, Organization $target, array $devices, array $extra = []): array
    {
        $move = $this->confirm($source, $target, $devices, $extra)->assertAccepted()->json('data');
        $this->answerStops();

        return $this->getJson($this->in($source).'/device-moves/'.$move['uuid'])->assertOk()->json('data');
    }

    /** The successor of a moved device. */
    protected function successor(Device $predecessor): Device
    {
        return Device::findOrFail($predecessor->movedTo()->firstOrFail()->successor_device_id);
    }

    /**
     * @template T
     *
     * @param  callable(): T  $action
     * @return T
     */
    protected function as(User $user, callable $action): mixed
    {
        $previous = auth()->guard('sanctum')->user();
        $this->actingAs($user, 'sanctum');
        try {
            return $action();
        } finally {
            if ($previous) {
                $this->actingAs($previous, 'sanctum');
            }
        }
    }
}
