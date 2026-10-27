<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Dashboards\Actions\SaveDashboard;
use App\Domain\Dashboards\Models\DashboardRevision;
use App\Domain\Dashboards\Services\DashboardAccess;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\Dashboards\Services\PanelSuggestions;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Geospatial\Models\Geofence;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class SaveDashboardTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->user = User::where('email', 'shared.operator@example.test')->firstOrFail();
    }

    public function test_create_makes_the_person_the_owner_and_records_who_made_the_version(): void
    {
        $dashboard = app(SaveDashboard::class)->create($this->organization, $this->user, $this->document('Energy'), 'assistant');

        $this->assertSame($this->user->id, $dashboard->created_by);
        $this->assertSame(DashboardAccess::ORGANIZATION, $dashboard->access);
        $this->assertSame(1, $dashboard->revision);
        $this->assertSame('assistant', DashboardRevision::where('dashboard_id', $dashboard->id)->sole()->origin);
    }

    public function test_update_refuses_a_stale_revision_and_keeps_the_newer_save(): void
    {
        $save = app(SaveDashboard::class);
        $dashboard = $save->create($this->organization, $this->user, $this->document('First'));
        $save->update($dashboard, $this->user, $this->document('Second'), 1, 'assistant');

        $this->assertThrows(fn () => $save->update($dashboard, $this->user, $this->document('Stale'), 1), fn (HttpException $exception): bool => $exception->getStatusCode() === 409);
        $this->assertSame('Second', $dashboard->fresh()->name);
        $this->assertSame([null, 'assistant'], DashboardRevision::where('dashboard_id', $dashboard->id)->orderBy('revision')->pluck('origin')->all());
    }

    public function test_validate_document_takes_source_details_from_the_applied_profile(): void
    {
        $source = [...$this->source($this->organization), 'device_name' => 'Renamed', 'unit' => 'F'];

        $document = app(DashboardDefinition::class)->validateDocument($this->document('Boiler', [$this->panel('status', ['sources' => [$source]])]), $this->organization, false);

        $this->assertSame('Boiler', $document['widgets'][0]['config']['sources'][0]['device_name']);
        $this->assertSame('C', $document['widgets'][0]['config']['sources'][0]['unit']);
    }

    public function test_validate_document_refuses_another_organizations_devices_workflows_and_geofences(): void
    {
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $workflow = Workflow::create(['organization_id' => $other->id, 'name' => 'Boundary', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $this->user->id]);
        $fence = Geofence::create(['organization_id' => $other->id, 'name' => 'Yard', 'revision' => 1,
            'geometry' => ['type' => 'Polygon', 'coordinates' => [[[-114.01, 50.99], [-113.99, 50.99], [-113.99, 51.01], [-114.01, 50.99]]]]]);
        $device = Device::create(['organization_id' => $this->organization->id, 'code' => (string) Str::uuid(), 'name' => 'Truck']);
        $panels = [
            'widgets.0.config.sources.0' => $this->panel('status', ['sources' => [$this->source($other)]]),
            'widgets.0.config.workflow_uuid' => $this->panel('alerts', ['sources' => [], 'workflow_uuid' => $workflow->uuid]),
            'widgets.0.config.geofence_uuid' => $this->panel('location', ['sources' => [], 'location_device_uuids' => [$device->uuid], 'geofence_uuid' => $fence->uuid]),
        ];

        foreach ($panels as $field => $panel) {
            $this->assertThrows(
                fn () => app(DashboardDefinition::class)->validateDocument($this->document('Mixed', [$panel]), $this->organization, false),
                fn (ValidationException $exception): bool => array_key_exists($field, $exception->errors()),
            );
        }
    }

    public function test_the_version_list_says_which_versions_the_assistant_made(): void
    {
        $dashboard = app(SaveDashboard::class)->create($this->organization, $this->user, $this->document('Energy'), 'assistant');
        $path = '/api/v1/organizations/'.$this->organization->uuid.'/dashboards/'.$dashboard->uuid;
        $this->actingAs($this->user, 'sanctum');
        $this->putJson($path, [...$this->document('Energy, edited'), 'revision' => 1])->assertOk();

        $this->getJson($path.'/revisions')
            ->assertOk()
            ->assertJsonPath('data.0.origin', null)
            ->assertJsonPath('data.1.origin', 'assistant');
    }

    /** @return array<string, mixed> */
    private function document(string $name, array $widgets = []): array
    {
        return ['name' => $name, 'widgets' => $widgets, 'layouts' => [], 'defaults' => DashboardDefinition::defaults()];
    }

    /** @return array<string, mixed> */
    private function panel(string $type, array $config): array
    {
        return ['id' => (string) Str::uuid(), 'schema_version' => 2, 'type' => $type, 'title' => 'Panel', 'description' => '', 'config' => $config];
    }

    /** @return array<string, mixed> A source for a new device with an applied profile in the organization. */
    private function source(Organization $organization): array
    {
        $parameter = ['uuid' => (string) Str::uuid(), 'label' => 'Temperature', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => 'C', 'format' => null, 'display' => [], 'validation' => []];
        $definition = ['parameters' => [$parameter]];
        $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => (string) Str::uuid(), 'name' => 'Boiler profile']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => hash('sha256', json_encode($definition)), 'compiled_at' => now()]);
        $device = Device::create(['organization_id' => $organization->id, 'code' => (string) Str::uuid(), 'name' => 'Boiler']);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => $artifact->definition_hash, 'definition' => ['profile_canonical_json' => json_encode($definition), 'mappings' => []], 'created_at' => now()]);
        $device->update(['last_applied_configuration_uuid' => $configuration->uuid, 'lifecycle' => 'deactivated']);

        return app(PanelSuggestions::class)->source(['uuid' => $device->uuid, 'name' => $device->name], $parameter, 0);
    }
}
