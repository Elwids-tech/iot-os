<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Geospatial;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\Devices\Models\Device;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Geospatial\Models\GeofenceActivationBatch;
use App\Domain\Geospatial\Models\GeofenceAssignment;
use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\GpsUseCaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Support\Contract\WithoutContractCheck;
use Tests\TestCase;

final class GeofenceTest extends TestCase
{
    use RefreshDatabase;

    private const RING = [[-114.01, 50.99], [-113.99, 50.99], [-113.99, 51.01], [-114.01, 51.01], [-114.01, 50.99]];

    private const POLICY = ['outside_for_seconds' => 60, 'max_gap_seconds' => 45, 'minimum_samples' => 2, 'uncertainty_metres' => 2.5];

    private Organization $organization;

    private Geofence $fence;

    private string $url;

    private ?array $runtimeMap = null;

    /** Answers the runtime's compile of an activation snapshot; null accepts it. */
    private ?\Closure $activation = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->seed(GpsUseCaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->fence = Geofence::where('uuid', GpsUseCaseSeeder::WORKFLOW_UUID)->firstOrFail();
        $this->url = '/api/v1/organizations/'.$this->organization->uuid.'/geofences/'.$this->fence->uuid;
        $this->actingAs(User::where('is_super_admin', true)->firstOrFail(), 'sanctum');
        config(['devices.runtime_token' => 'test', 'devices.runtime_url' => 'http://runtime']);
        Http::fake(function (Request $request) {
            if ($this->runtimeMap !== null && str_ends_with($request->url(), '/internal/locations/map')) {
                return Http::response($this->runtimeMap);
            }
            // An activation snapshot carries its activation item's operation UUID as its version.
            $version = $request['workflow']['version_uuid'] ?? null;
            if ($this->activation && $version && DB::table('geofence_activation_items')->where('operation_uuid', $version)->exists()
                && ($response = ($this->activation)()) !== null) {
                return $response;
            }
            $definition = Workflow::where('uuid', GpsUseCaseSeeder::WORKFLOW_UUID)->firstOrFail()->definition;

            return Http::response(['valid' => true, 'definition' => $definition, 'definition_hash' => str_repeat('b', 64)]);
        });
    }

    public function test_update_and_activate_is_idempotent_and_conflicts_on_reuse(): void
    {
        $operation = (string) Str::uuid();
        $input = $this->input($operation);

        $first = $this->putJson($this->url, $input)->assertAccepted()
            ->assertJsonPath('data.revision', 2)
            ->assertJsonPath('activation.uuid', $operation)
            ->assertJsonPath('activation.status', 'partial_failure');
        $this->putJson($this->url, $input)->assertAccepted()->assertExactJson($first->json());

        $this->assertSame(2, $this->fence->fresh()->revision);
        $this->assertSame(1, GeofenceActivationBatch::where('uuid', $operation)->count());
        $this->assertSame(3, GeofenceAssignment::where('geofence_id', $this->fence->id)->count());

        $this->putJson($this->url, [...$input, 'name' => 'A different request'])->assertConflict();
    }

    public function test_event_history_is_tenant_scoped(): void
    {
        $assignment = GeofenceAssignment::where('geofence_id', $this->fence->id)->firstOrFail();
        $event = ['uuid' => (string) Str::uuid(), 'geofence_uuid' => $this->fence->uuid, 'geofence_name' => $this->fence->name,
            'assignment_uuid' => $assignment->uuid, 'device_uuid' => GpsUseCaseSeeder::DEVICE_UUID, 'type' => 'exited',
            'source_event_uuid' => (string) Str::uuid(), 'occurred_at' => now()->toIso8601String()];
        DB::table('geofence_events')->insert(['uuid' => $event['uuid'], 'organization_id' => $this->organization->id,
            'geofence_id' => $this->fence->id, 'geofence_assignment_id' => $assignment->id, 'transition_id' => str_repeat('a', 64),
            'type' => 'exited', 'source_event_uuid' => $event['source_event_uuid'], 'snapshot' => json_encode($event, JSON_THROW_ON_ERROR),
            'occurred_at' => $event['occurred_at'], 'recorded_at' => now()]);

        $this->getJson($this->url.'/events')->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.uuid', $event['uuid'])->assertJsonPath('data.0.type', 'exited');

        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/geofences/'.$this->fence->uuid.'/events')->assertNotFound();
    }

    public function test_directory_accepts_an_empty_search_query(): void
    {
        $this->getJson('/api/v1/organizations/'.$this->organization->uuid.'/geofences?search=&page=1')
            ->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.uuid', $this->fence->uuid);
    }

    public function test_location_map_enriches_the_runtime_device_with_assignment_state(): void
    {
        $assignment = GeofenceAssignment::where('geofence_id', $this->fence->id)->firstOrFail();
        $binding = LocationBinding::findOrFail($assignment->device_location_binding_id);
        $this->runtimeMap = ['devices' => [['device_uuid' => GpsUseCaseSeeder::DEVICE_UUID,
            'device_name' => 'GPS Demo Tracker', 'binding_uuid' => $binding->uuid, 'latest' => null,
            'condition' => 'unknown', 'active' => false, 'trail' => ['segments' => [], 'sampled' => false]]]];

        $response = $this->postJson('/api/v1/organizations/'.$this->organization->uuid.'/location-map/query', [
            'device_uuids' => [GpsUseCaseSeeder::DEVICE_UUID], 'trail_window' => '24h', 'include_trails' => true,
            'geofence_uuid' => $this->fence->uuid,
        ]);
        $response->assertOk()->assertJsonPath('data.devices.0.assignment_status', $assignment->status)
            ->assertJsonPath('data.devices.0.deployment_status', $assignment->workflow->deployment_status)
            ->assertJsonPath('data.devices.0.wandering', false);
    }

    public function test_integration_mutations_require_management_and_the_complete_device_grant(): void
    {
        $admin = User::where('is_super_admin', true)->firstOrFail()->createToken('admin')->plainTextToken;
        $manage = '/api/v1/organizations/'.$this->organization->uuid.'/applications';
        $integration = '/api/integration/v1/organizations/'.$this->organization->uuid.'/geofences/'.$this->fence->uuid;

        $readOnly = $this->applicationToken($admin, $manage, [GpsUseCaseSeeder::DEVICE_UUID], ['geofences:activate']);
        Auth::forgetGuards();
        $this->withToken($readOnly)->putJson($integration, $this->input((string) Str::uuid()))->assertForbidden();

        $otherDevice = Device::create(['organization_id' => $this->organization->id, 'code' => 'other-gps', 'name' => 'Other GPS']);
        $outsideGrant = $this->applicationToken($admin, $manage, [$otherDevice->uuid], ['geofences:manage', 'geofences:activate']);
        Auth::forgetGuards();
        $this->withToken($outsideGrant)->putJson($integration, $this->input((string) Str::uuid()))->assertForbidden();
    }

    public function test_assignment_is_deleted_only_after_successful_deactivation_and_batch_history_survives(): void
    {
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $device = Device::create(['organization_id' => $this->organization->id, 'code' => 'remove-me', 'name' => 'Remove me']);
        $binding = LocationBinding::create(['organization_id' => $this->organization->id, 'device_id' => $device->id,
            'configuration_uuid' => (string) Str::uuid(), 'generation' => 1, 'latitude_parameter_uuid' => (string) Str::uuid(),
            'longitude_parameter_uuid' => (string) Str::uuid(), 'max_age_seconds' => 90, 'max_future_skew_seconds' => 5,
            'allow_unknown_accuracy' => true, 'revision' => 1, 'updated_by' => $actor->id]);
        $workflow = Workflow::create(['organization_id' => $this->organization->id, 'name' => 'Removed assignment',
            'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('c', 64), 'updated_by' => $actor->id]);
        $removed = GeofenceAssignment::create(['organization_id' => $this->organization->id, 'geofence_id' => $this->fence->id,
            'device_location_binding_id' => $binding->id, 'automation_workflow_id' => $workflow->id,
            'policy' => ['outside_for_seconds' => 60, 'max_gap_seconds' => 45, 'minimum_samples' => 2, 'uncertainty_metres' => 2],
            'desired_geofence_revision' => 1, 'applied_geofence_revision' => 1, 'status' => 'active']);

        $response = $this->putJson($this->url, $this->input((string) Str::uuid()))->assertAccepted()->json();
        $item = collect($response['activation']['items'])->firstWhere('target', 'inactive');
        $deployment = Deployment::where('uuid', $item['operation_uuid'])->firstOrFail();
        app(WorkflowDeploymentService::class)->event('workflow.deployment.v1', ['rule_uuid' => $workflow->uuid,
            'organization_uuid' => $this->organization->uuid, 'operation_uuid' => $deployment->uuid,
            'generation' => $deployment->generation, 'target' => 'inactive', 'status' => 'succeeded']);

        $this->getJson($this->url.'/activations/'.$response['activation']['uuid'])->assertOk()
            ->assertJsonPath('data.items.3.assignment_uuid', $removed->uuid)
            ->assertJsonPath('data.items.3.device_uuid', $device->uuid)
            ->assertJsonPath('data.items.3.status', 'succeeded');
        $this->assertDatabaseMissing('geofence_assignments', ['id' => $removed->id]);
        $this->assertDatabaseHas('geofence_activation_items', ['id' => $item['id'], 'geofence_assignment_id' => null,
            'assignment_uuid' => $removed->uuid, 'device_uuid' => $device->uuid]);
    }

    public function test_a_runtime_rejection_during_activation_fails_that_item_and_the_item_can_be_retried(): void
    {
        $this->makeDeviceActivatable();
        $rejections = 1;
        $this->activation = function () use (&$rejections) {
            return $rejections-- > 0 ? Http::response(['message' => 'The runtime rejected this snapshot.'], 422) : null;
        };

        $response = $this->putJson($this->url, $this->input((string) Str::uuid()))->assertAccepted()
            ->assertJsonPath('data.revision', 2)
            ->assertJsonPath('activation.items.0.status', 'failed')
            ->assertJsonPath('activation.items.0.diagnostic', 'The runtime rejected this snapshot.')
            ->json();
        $failed = $response['activation']['items'][0];
        $this->assertDatabaseHas('geofence_assignments', ['uuid' => $failed['assignment_uuid'], 'status' => 'failed',
            'diagnostic' => 'The runtime rejected this snapshot.']);
        // The rejection did not stop the other items from being requested.
        foreach (array_slice($response['activation']['items'], 1) as $item) {
            $this->assertSame('pending', $item['status']);
            $this->assertTrue(Deployment::where('uuid', $item['operation_uuid'])->exists());
        }

        $this->postJson($this->url.'/activations/'.$response['activation']['uuid'].'/items/'.$failed['id'].'/retry')->assertOk()
            ->assertJsonPath('data.items.0.status', 'pending');
        $this->assertTrue(Deployment::where('uuid', DB::table('geofence_activation_items')->where('id', $failed['id'])->value('operation_uuid'))->exists());
    }

    public function test_integration_activation_failures_keep_the_saved_geofence_and_stay_retryable(): void
    {
        $this->makeDeviceActivatable();
        $this->activation = fn () => Http::response(['message' => 'The runtime rejected this snapshot.'], 422);
        [$token, $geofences] = $this->integrationClient();

        $created = $this->withToken($token)->postJson($geofences, [...$this->input((string) Str::uuid()), 'name' => 'Integration boundary', 'expected_revision' => 0])
            ->assertAccepted()->assertJsonPath('data.revision', 1)->assertJsonPath('activation.status', 'partial_failure')->json();
        $this->assertCount(3, $created['activation']['items']);
        foreach ($created['activation']['items'] as $item) {
            $this->assertSame(['failed', 'The runtime rejected this snapshot.'], [$item['status'], $item['diagnostic']]);
        }
        $retry = $geofences.'/'.$created['data']['uuid'].'/activations/'.$created['activation']['uuid'].'/items/'.$created['activation']['items'][0]['id'].'/retry';

        // Still rejected: the item fails again instead of staying pending.
        $this->withToken($token)->postJson($retry)->assertOk()
            ->assertJsonPath('data.items.0.status', 'failed')->assertJsonPath('data.items.0.diagnostic', 'The runtime rejected this snapshot.');
        // An unreachable runtime fails the item too, so it can be retried later.
        $this->activation = fn () => Http::failedConnection();
        $this->withToken($token)->postJson($retry)->assertOk()
            ->assertJsonPath('data.items.0.status', 'failed')->assertJsonPath('data.items.0.diagnostic', 'The device runtime is unavailable.');
        $this->activation = null;
        $this->withToken($token)->postJson($retry)->assertOk()->assertJsonPath('data.items.0.status', 'pending');
    }

    public function test_activation_items_whose_device_or_assignment_is_gone_fail_with_a_diagnostic(): void
    {
        // The activation snapshot binds a device that no longer exists in the organization.
        $seeded = Workflow::where('uuid', GpsUseCaseSeeder::WORKFLOW_UUID)->firstOrFail();
        $definition = $seeded->definition;
        $definition['binding']['device_uuid'] = (string) Str::uuid();
        $seeded->update(['definition' => $definition]);

        $response = $this->putJson($this->url, $this->input((string) Str::uuid()))->assertAccepted()
            ->assertJsonPath('data.revision', 2)->assertJsonPath('activation.status', 'partial_failure')->json();
        foreach ($response['activation']['items'] as $item) {
            $this->assertSame(['failed', 'The device for this activation no longer exists.'], [$item['status'], $item['diagnostic']]);
        }

        // A later deactivation removed the assignment of a failed item.
        $item = $response['activation']['items'][0];
        DB::table('geofence_activation_items')->where('id', $item['id'])->update(['geofence_assignment_id' => null]);
        $this->postJson($this->url.'/activations/'.$response['activation']['uuid'].'/items/'.$item['id'].'/retry')->assertOk()
            ->assertJsonPath('data.items.0.status', 'failed')
            ->assertJsonPath('data.items.0.diagnostic', 'The geofence assignment for this activation no longer exists.');
    }

    public function test_numeric_strings_are_stored_as_numbers_and_a_string_revision_is_compared_as_an_integer(): void
    {
        $input = [...$this->stringInput((string) Str::uuid()), 'expected_revision' => '1'];

        $response = $this->putJson($this->url, $input)->assertAccepted()->assertJsonPath('data.revision', 2);

        $this->assertSame(self::RING, $response->json('data.geometry.coordinates.0'));
        $this->assertSame(self::RING, $this->fence->fresh()->geometry['coordinates'][0]);
        $this->assertCount(3, $response->json('data.assignments'));
        foreach ($response->json('data.assignments') as $assignment) {
            $this->assertSameJsonDocument(self::POLICY, $assignment['policy']);
        }
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/internal/workflows/compile')
            && $request['workflow']['nodes'][1]['config']['geometry']['coordinates'][0] === self::RING
            && $request['workflow']['nodes'][2]['config']['minimum_samples'] === self::POLICY['minimum_samples']);
    }

    public function test_integration_numeric_strings_are_stored_as_numbers_and_a_string_revision_is_compared_as_an_integer(): void
    {
        [$token, $geofences] = $this->integrationClient();
        $input = [...$this->stringInput((string) Str::uuid()), 'name' => 'Integration boundary', 'expected_revision' => '0'];

        $created = $this->withToken($token)->postJson($geofences, $input)->assertAccepted()->assertJsonPath('data.revision', 1);
        $this->assertSame(self::RING, $created->json('data.geometry.coordinates.0'));
        $this->assertSameJsonDocument(self::POLICY, $created->json('data.assignments.0.policy'));

        $this->withToken($token)->putJson($geofences.'/'.$created->json('data.uuid'), [...$input, 'operation_uuid' => (string) Str::uuid(), 'expected_revision' => '1'])
            ->assertAccepted()->assertJsonPath('data.revision', 2);
    }

    #[WithoutContractCheck('Geofence validation errors (422) are not in the contract yet; spec 001 PR 3 documents them for the integration API.')]
    public function test_non_numeric_strings_still_fail_geofence_validation(): void
    {
        $input = $this->input((string) Str::uuid());
        $input['expected_revision'] = 'one';
        $input['geometry']['coordinates'][0][1][1] = 'north';
        $input['assignments'][0]['policy']['minimum_samples'] = 'two';
        $input['assignments'][0]['policy']['uncertainty_metres'] = '2m';
        $errors = ['expected_revision', 'geometry.coordinates.0.1.1', 'assignments.0.policy.minimum_samples', 'assignments.0.policy.uncertainty_metres'];

        $this->putJson($this->url, $input)->assertUnprocessable()->assertJsonValidationErrors($errors);
        [$token, $geofences] = $this->integrationClient();
        $this->withToken($token)->postJson($geofences, $input)->assertUnprocessable()->assertJsonValidationErrors($errors);
    }

    /** A valid request with every coordinate and policy value sent as a JSON string. */
    private function stringInput(string $operation): array
    {
        $strings = fn (array $values): array => array_map(fn (int|float $value): string => (string) $value, $values);

        return [...$this->input($operation),
            'geometry' => ['type' => 'Polygon', 'coordinates' => [array_map($strings, self::RING)]],
            'assignments' => array_map(fn (string $uuid) => ['device_uuid' => $uuid, 'policy' => $strings(self::POLICY)], GpsUseCaseSeeder::deviceUuids())];
    }

    /** Lets the activation snapshot of the seeded workflow pass the applied-configuration check. */
    private function makeDeviceActivatable(): void
    {
        $binding = Workflow::where('uuid', GpsUseCaseSeeder::WORKFLOW_UUID)->firstOrFail()->definition['binding'];
        Device::where('uuid', $binding['device_uuid'])->update(['lifecycle' => 'active', 'deployment_status' => 'applied',
            'applied_configuration_uuid' => $binding['configuration_uuid'], 'deployment_generation' => $binding['generation']]);
    }

    /** @return array{string, string} an integration token granted every GPS device, and the geofence collection URL */
    private function integrationClient(): array
    {
        $admin = User::where('is_super_admin', true)->firstOrFail()->createToken('admin')->plainTextToken;
        $token = $this->applicationToken($admin, '/api/v1/organizations/'.$this->organization->uuid.'/applications',
            GpsUseCaseSeeder::deviceUuids(), ['geofences:read', 'geofences:manage', 'geofences:activate']);
        Auth::forgetGuards();

        return [$token, '/api/integration/v1/organizations/'.$this->organization->uuid.'/geofences'];
    }

    private function input(string $operation): array
    {
        $assignment = GeofenceAssignment::where('geofence_id', $this->fence->id)->firstOrFail();

        return ['operation_uuid' => $operation, 'expected_revision' => 1, 'name' => 'GPS Demo Boundary',
            'geometry' => $this->fence->geometry,
            'assignments' => array_map(fn (string $uuid) => ['device_uuid' => $uuid, 'policy' => $assignment->policy], GpsUseCaseSeeder::deviceUuids())];
    }

    private function applicationToken(string $admin, string $manage, array $devices, array $abilities): string
    {
        Auth::forgetGuards();
        $application = $this->withToken($admin)->postJson($manage, ['name' => 'Geofence client', 'device_uuids' => $devices, 'abilities' => $abilities])
            ->assertCreated()->json('data');
        Auth::forgetGuards();

        return $this->withToken($admin)->postJson($manage.'/'.$application['uuid'].'/token', [
            'revision' => $application['revision'], 'expires_in_days' => 1, 'abilities' => $abilities,
        ])->assertCreated()->json('data.token');
    }
}
