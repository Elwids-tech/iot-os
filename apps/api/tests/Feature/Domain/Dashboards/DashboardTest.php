<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Services\DashboardDefinition;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

final class DashboardTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private string $url;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        $this->url = '/api/v1/organizations/'.$this->organization->uuid.'/dashboards';
    }

    private function emptyDashboard(string $name = 'Operations'): array
    {
        return ['name' => $name, 'widgets' => [], 'layouts' => [], 'defaults' => DashboardDefinition::defaults()];
    }

    private function source(string $unit = 'C', string $dataType = 'number'): array
    {
        $parameter = ['uuid' => (string) Str::uuid(), 'label' => 'Temperature', 'data_type' => $dataType, 'unit' => $unit];
        $definition = ['parameters' => [$parameter]];
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => (string) Str::uuid(), 'name' => 'Test profile']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => hash('sha256', json_encode($definition)), 'compiled_at' => now()]);
        $device = Device::create(['organization_id' => $this->organization->id, 'code' => (string) Str::uuid(), 'name' => 'Applied device']);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => $artifact->definition_hash, 'definition' => ['profile_canonical_json' => json_encode($definition)], 'created_at' => now()]);
        $device->update(['last_applied_configuration_uuid' => $configuration->uuid, 'lifecycle' => 'deactivated']);

        return ['device_uuid' => $device->uuid, 'parameter_uuid' => $parameter['uuid'], 'label' => 'Room temperature', 'unit' => 'C', 'data_type' => 'number', 'precision' => 2, 'color' => '#2563eb', 'base' => ['label' => 'Below range', 'color' => '#64748b'], 'thresholds' => array_map(fn ($v) => ['value' => $v, 'label' => 'Band '.$v, 'color' => '#2563eb'], [-10, 0, 20, 40, 80])];
    }

    private function panel(array $source, string $type = 'status'): array
    {
        return ['id' => (string) Str::uuid(), 'schema_version' => 2, 'type' => $type, 'title' => 'Temperature overview', 'description' => 'Operator view', 'config' => ['sources' => [$source]]];
    }

    public function test_multiple_dashboards_are_independent_and_updates_are_revision_checked(): void
    {
        $first = $this->postJson($this->url, $this->emptyDashboard('First'))->assertSuccessful()->json('data');
        $second = $this->postJson($this->url, $this->emptyDashboard('Second'))->assertSuccessful()->json('data');
        $this->getJson($this->url)->assertJsonCount(2, 'data');
        $values = [...$this->emptyDashboard('Renamed'), 'revision' => 1];
        $this->putJson($this->url.'/'.$first['uuid'], $values)->assertOk()->assertJsonPath('data.revision', 2);
        $this->putJson($this->url.'/'.$first['uuid'], $values)->assertConflict();
        $this->getJson($this->url.'/'.$second['uuid'])->assertOk()->assertJsonPath('data.name', 'Second')->assertJsonPath('data.revision', 1);
        $this->putJson($this->url.'/'.$second['uuid'], $this->emptyDashboard())->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$other->uuid.'/dashboards/'.$first['uuid'])->assertNotFound();
    }

    public function test_legacy_reads_normalize_without_mutating_saved_configuration(): void
    {
        $source = $this->source();
        $legacy = [['id' => 'existing', 'type' => 'status', 'config' => ['sources' => [['device_uuid' => $source['device_uuid'], 'parameter_uuid' => $source['parameter_uuid']]], 'thresholds' => $source['thresholds']]]];
        $dashboard = Dashboard::create(['organization_id' => $this->organization->id, 'name' => 'Legacy', 'widgets' => $legacy, 'layouts' => []]);
        $view = $this->getJson($this->url.'/'.$dashboard->uuid)->assertOk()->assertJsonPath('data.widgets.0.title', 'Status')->assertJsonPath('data.widgets.0.config.sources.0.base.label', 'Below range')->json('data');
        $this->assertSame($legacy, $dashboard->fresh()->widgets);
        $this->putJson($this->url.'/'.$dashboard->uuid, array_intersect_key($view, array_flip(['name', 'widgets', 'layouts', 'defaults', 'revision'])))->assertOk()->assertJsonPath('data.widgets.0.config.sources.0.unit', 'C')->assertJsonCount(5, 'data.widgets.0.config.sources.0.thresholds');
    }

    public function test_applied_parameters_without_readings_and_many_thresholds_can_be_saved(): void
    {
        $source = $this->source();
        $panel = $this->panel($source);
        $payload = [...$this->emptyDashboard(), 'widgets' => [$panel], 'layouts' => ['lg' => [['i' => $panel['id'], 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 6]]]];
        $this->postJson($this->url, $payload)->assertSuccessful()->assertJsonCount(5, 'data.widgets.0.config.sources.0.thresholds')->assertJsonPath('data.widgets.0.title', 'Temperature overview');
        $panel['config']['sources'][0]['thresholds'][] = $source['thresholds'][0];
        $this->postJson($this->url, [...$payload, 'widgets' => [$panel]])->assertUnprocessable();
        $panel['config']['sources'][0] = $source;
        $panel['config']['sources'][0]['parameter_uuid'] = (string) Str::uuid();
        $this->postJson($this->url, [...$payload, 'widgets' => [$panel]])->assertUnprocessable();
    }

    public function test_forged_sources_duplicate_sources_and_invalid_layouts_are_rejected(): void
    {
        $source = $this->source();
        $panel = $this->panel($source);
        $panel['config']['sources'][] = $source;
        $this->postJson($this->url, [...$this->emptyDashboard(), 'widgets' => [$panel]])->assertUnprocessable();
        $panel['config']['sources'] = [$source];
        $bad = [...$this->emptyDashboard(), 'widgets' => [$panel], 'layouts' => ['xs' => [['i' => $panel['id'], 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 6]]]];
        $this->postJson($this->url, $bad)->assertUnprocessable();
        $other = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        Device::where('uuid', $source['device_uuid'])->update(['organization_id' => $other->id]);
        $this->postJson($this->url, [...$this->emptyDashboard(), 'widgets' => [$panel]])->assertUnprocessable();
    }

    public function test_history_defaults_validate_bounds_and_timezone(): void
    {
        $payload = $this->emptyDashboard();
        $payload['defaults']['range'] = ['mode' => 'absolute', 'from' => '2026-01-02T00:00:00Z', 'to' => '2026-01-01T00:00:00Z'];
        $this->postJson($this->url, $payload)->assertUnprocessable();
        $payload['defaults']['range'] = ['mode' => 'absolute', 'from' => '2026-01-01T00:00:00Z', 'to' => '2026-01-02T00:00:00Z'];
        $payload['defaults']['timezone'] = 'utc';
        $this->postJson($this->url, $payload)->assertSuccessful();
    }

    public function test_user_without_dashboard_management_cannot_create(): void
    {
        $this->actingAs(User::factory()->create(), 'sanctum');
        $this->postJson($this->url, $this->emptyDashboard())->assertForbidden();
    }

    public function test_time_series_validates_authoritative_profile_units_and_data_types(): void
    {
        $first = $this->source();
        $second = $this->source();
        $panel = $this->panel($first, 'timeseries');
        $panel['config']['sources'][] = $second;
        $this->postJson($this->url, [...$this->emptyDashboard(), 'widgets' => [$panel]])->assertSuccessful()->assertJsonCount(2, 'data.widgets.0.config.sources');
        // Metadata in the request must not disguise a different profile unit or type.
        $panel['config']['sources'][1] = $this->source('V');
        $this->postJson($this->url, [...$this->emptyDashboard(), 'widgets' => [$panel]])->assertUnprocessable();
        $panel['config']['sources'] = [$this->source('C', 'string')];
        $this->postJson($this->url, [...$this->emptyDashboard(), 'widgets' => [$panel]])->assertUnprocessable();
    }
}
