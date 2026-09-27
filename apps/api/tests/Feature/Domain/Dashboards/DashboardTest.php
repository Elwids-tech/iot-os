<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Dashboards;

use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Models\DashboardRevision;
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

    public function test_workflow_picker_accepts_empty_search_and_panels_require_a_workflow(): void
    {
        $this->getJson('/api/v1/organizations/'.$this->organization->uuid.'/workflows?search=')->assertOk();
        $panel = ['id' => 'location', 'schema_version' => 2, 'type' => 'location', 'title' => 'Location', 'description' => '', 'config' => ['sources' => []]];
        $this->postJson($this->url, [...$this->emptyDashboard(), 'widgets' => [$panel]])->assertUnprocessable();
    }

    private function emptyDashboard(string $name = 'Operations'): array
    {
        return ['name' => $name, 'widgets' => [], 'layouts' => [], 'defaults' => DashboardDefinition::defaults()];
    }

    public function test_gps_and_overhaul_panels_share_library_revision_history(): void
    {
        $source = $this->source();
        $gauge = $this->panel($source, 'gauge');
        $gauge['config'] += ['min' => 0, 'max' => 100];
        $gps = ['id' => 'gps', 'schema_version' => 2, 'type' => 'location', 'title' => 'GPS', 'description' => '', 'config' => ['sources' => [], 'location_device_uuids' => [$source['device_uuid']], 'show_trails' => true, 'trail_window' => '24h']];
        $input = [...$this->emptyDashboard(), 'tags' => ['field'], 'folder' => 'Operations', 'widgets' => [$gps, $gauge, [...$gps, 'id' => 'gps-copy']]];
        $response = $this->postJson($this->url, $input)->assertOk()->assertJsonPath('data.widgets.0.config.location_device_uuids.0', $source['device_uuid']);
        $dashboard = Dashboard::where('uuid', $response->json('data.uuid'))->firstOrFail();
        $revision = DashboardRevision::where('dashboard_id', $dashboard->id)->firstOrFail();
        $this->assertSame($gps['config'], $revision->widgets[0]['config']);
        $this->assertSame(['field'], $revision->tags);
        $input['widgets'][1]['config']['location_device_uuids'] = [$source['device_uuid']];
        $this->postJson($this->url, $input)->assertUnprocessable()->assertJsonValidationErrors('widgets.1.config');
        unset($input['widgets'][1]['config']['location_device_uuids']);
        $input['widgets'][0]['config']['location_device_uuids'][] = $source['device_uuid'];
        $this->postJson($this->url, $input)->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config.location_device_uuids');
    }

    private function source(string $unit = 'C', string $dataType = 'number', bool $writable = false, ?string $format = null, ?string $displayWidget = null): array
    {
        $parameter = [
            'uuid' => (string) Str::uuid(), 'label' => 'Temperature', 'data_type' => $dataType,
            'unit' => $unit, 'kind' => 'state', 'reports_state' => true, 'accepts_command' => $writable,
            'format' => $format, 'display' => $displayWidget ? ['widget' => $displayWidget] : [],
        ];
        $definition = ['parameters' => [$parameter]];
        $profile = DeviceProfile::create(['organization_id' => $this->organization->id, 'code' => (string) Str::uuid(), 'name' => 'Test profile']);
        $artifact = DeviceProfileArtifact::create(['device_profile_id' => $profile->id, 'revision' => 1, 'definition' => $definition, 'definition_hash' => hash('sha256', json_encode($definition)), 'compiled_at' => now()]);
        $device = Device::create(['organization_id' => $this->organization->id, 'code' => (string) Str::uuid(), 'name' => 'Applied device']);
        $configuration = DeviceConfiguration::create(['device_id' => $device->id, 'device_profile_artifact_id' => $artifact->id, 'revision' => 1, 'definition_hash' => $artifact->definition_hash, 'definition' => ['profile_canonical_json' => json_encode($definition), 'mappings' => [['parameter_uuid' => $parameter['uuid'], 'metric' => 'Temperature', 'command_metric' => $writable ? 'Temperature' : null]]], 'created_at' => now()]);
        $device->update(['last_applied_configuration_uuid' => $configuration->uuid, 'lifecycle' => 'deactivated']);
        if ($writable) {
            $device->update(['applied_configuration_uuid' => $configuration->uuid, 'lifecycle' => 'active', 'deployment_status' => 'applied']);
        }

        return ['device_uuid' => $device->uuid, 'parameter_uuid' => $parameter['uuid'], 'label' => 'Room temperature', 'unit' => 'C', 'data_type' => 'number', 'precision' => 2, 'color' => '#2563eb', 'base' => ['label' => 'Below range', 'color' => '#64748b'], 'thresholds' => array_map(fn ($v) => ['value' => $v, 'label' => 'Band '.$v, 'color' => '#2563eb'], [-10, 0, 20, 40, 80])];
    }

    private function panel(array $source, string $type = 'status'): array
    {
        return ['id' => (string) Str::uuid(), 'schema_version' => 2, 'type' => $type, 'title' => 'Temperature overview', 'description' => 'Operator view', 'config' => ['sources' => [$source]]];
    }

    public function test_controls_resolve_applied_metadata_and_reject_read_only_sources(): void
    {
        $source = $this->source('%', 'integer', true);
        $values = [...$this->emptyDashboard(), 'widgets' => [['id' => 'control', 'schema_version' => 2, 'type' => 'controls', 'title' => 'Controls', 'description' => '', 'config' => ['sources' => [$source], 'columns' => 3]]]];
        $this->postJson($this->url, $values)->assertOk()->assertJsonPath('data.widgets.0.config.columns', 3)->assertJsonPath('data.widgets.0.config.sources.0.data_type', 'integer')->assertJsonPath('data.widgets.0.config.sources.0.unit', '%')->assertJsonPath('data.widgets.0.config.sources.0.thresholds', []);
        $values['widgets'][0]['config']['columns'] = 5;
        $this->postJson($this->url, $values)->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config.columns');
        unset($values['widgets'][0]['config']['columns']);
        $this->postJson($this->url, $values)->assertOk()->assertJsonMissingPath('data.widgets.0.config.columns');
        $values['widgets'][0]['config']['columns'] = 'auto';
        $values['widgets'][0]['type'] = 'status';
        $this->postJson($this->url, $values)->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config.columns');
        $values['widgets'][0]['type'] = 'controls';
        unset($values['widgets'][0]['config']['columns']);
        $values['widgets'][0]['config']['sources'] = [$this->source()];
        $this->postJson($this->url, $values)->assertUnprocessable();
        $device = Device::where('uuid', $source['device_uuid'])->firstOrFail();
        $device->update(['applied_configuration_uuid' => null]);
        $values['widgets'][0]['config']['sources'] = [$source];
        $this->postJson($this->url, $values)->assertUnprocessable();
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
        // Snapshots backfilled by the library migration keep legacy widgets and null defaults.
        \App\Domain\Dashboards\Models\DashboardRevision::create(['dashboard_id' => $dashboard->id, 'revision' => 1, 'name' => 'Legacy', 'widgets' => $legacy, 'layouts' => [], 'defaults' => null, 'tags' => []]);
        $this->postJson($this->url.'/'.$dashboard->uuid.'/revisions/1/restore', ['revision' => 2])->assertOk()->assertJsonPath('data.revision', 3)->assertJsonPath('data.widgets.0.schema_version', 2)->assertJsonPath('data.defaults.refresh', 5);
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

    public function test_state_and_colour_history_use_authoritative_profile_semantics(): void
    {
        $boolean = $this->source('', 'boolean');
        $statePanel = $this->panel($boolean, 'state_history');
        $statePayload = [...$this->emptyDashboard(),
            'widgets' => [$statePanel],
            'layouts' => ['lg' => [['i' => $statePanel['id'], 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 6]]],
        ];
        $this->postJson($this->url, $statePayload)
            ->assertOk()
            ->assertJsonPath('data.widgets.0.config.sources.0.data_type', 'boolean')
            ->assertJsonPath('data.widgets.0.config.sources.0.thresholds', []);

        $numeric = $this->source();
        $statePayload['widgets'][0]['config']['sources'] = [$numeric];
        $this->postJson($this->url, $statePayload)->assertUnprocessable();

        $colour = $this->source('', 'string', false, 'hex_color', 'color');
        $colour['data_type'] = 'number';
        $colour['format'] = 'forged';
        $colour['display_widget'] = 'forged';
        $colourPanel = $this->panel($colour, 'color_history');
        $colourPayload = [...$this->emptyDashboard(),
            'widgets' => [$colourPanel],
            'layouts' => ['lg' => [['i' => $colourPanel['id'], 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 6]]],
        ];
        $this->postJson($this->url, $colourPayload)
            ->assertOk()
            ->assertJsonPath('data.widgets.0.config.sources.0.data_type', 'string')
            ->assertJsonPath('data.widgets.0.config.sources.0.format', 'hex_color')
            ->assertJsonPath('data.widgets.0.config.sources.0.display_widget', 'color');

        $plainString = $this->source('', 'string');
        $colourPayload['widgets'][0]['config']['sources'] = [$plainString];
        $this->postJson($this->url, $colourPayload)->assertUnprocessable();
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

    public function test_workflow_widgets_are_tenant_scoped_and_do_not_accept_parameter_sources(): void
    {
        $workflow = \App\Domain\Automation\Models\Workflow::create(['organization_id' => $this->organization->id, 'name' => 'Boundary', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('a',64), 'updated_by' => auth()->id()]);
        foreach (['location', 'alerts'] as $type) {
            $input = [...$this->emptyDashboard(), 'widgets' => [['id' => $type, 'schema_version' => 2, 'type' => $type, 'title' => 'Workflow panel', 'description' => '', 'config' => ['sources' => [], 'workflow_uuid' => $workflow->uuid]]]];
            $this->postJson($this->url, $input)->assertOk()->assertJsonPath('data.widgets.0.config.workflow_uuid', $workflow->uuid);
            $input['widgets'][0]['config']['sources'] = [$this->source()];
            $this->postJson($this->url, $input)->assertUnprocessable();
            $input['widgets'][0]['config']['sources'] = [];
            $input['widgets'][0]['config']['workflow_uuid'] = (string) Str::uuid();
            $this->postJson($this->url, $input)->assertUnprocessable();
        }
        $path = '/api/v1/organizations/'.$this->organization->uuid.'/workflows/'.$workflow->uuid;
        $this->getJson($path.'/location-overview')->assertOk()->assertJsonPath('data.snapshot', null);
        $this->getJson($path.'/alert-overview')->assertOk()->assertJsonPath('data.active', 0)->assertJsonPath('data.recent', []);
        $workflow->update(['organization_id' => Organization::where('slug', 'northstar-utilities')->firstOrFail()->id]);
        $this->getJson($path.'/location-overview')->assertNotFound();
        $this->getJson($path.'/alert-overview')->assertNotFound();
    }

    public function test_alert_overview_keeps_acknowledgement_separate_from_active_condition(): void
    {
        $workflow = \App\Domain\Automation\Models\Workflow::create(['organization_id' => $this->organization->id, 'name' => 'Boundary', 'workflow' => ['nodes' => []], 'definition' => [], 'definition_hash' => str_repeat('a',64), 'updated_by' => auth()->id()]);
        $version = \App\Domain\Automation\Models\Deployment::create(['automation_workflow_id' => $workflow->id, 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition' => [], 'definition_hash' => str_repeat('a',64), 'created_by' => auth()->id(), 'created_at' => now()]);
        foreach ([[null,null],[null,now()],[now(),null]] as $i => [$cleared,$ack]) {
            \App\Domain\Automation\Models\Alert::create(['organization_id' => $this->organization->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $version->id, 'episode' => $i+1, 'activated_at' => now(), 'cleared_at' => $cleared, 'acknowledged_at' => $ack]);
        }
        $this->getJson('/api/v1/organizations/'.$this->organization->uuid.'/workflows/'.$workflow->uuid.'/alert-overview')->assertOk()->assertJsonPath('data.active',2)->assertJsonPath('data.unacknowledged_active',1)->assertJsonPath('data.total',3)->assertJsonPath('data.recent.0.episode',3);
    }

    private function actAs(string $email): void
    {
        $this->actingAs(User::where('email', $email)->firstOrFail(), 'sanctum');
    }

    private function widgetPayload(array $widget): array
    {
        return [...$this->emptyDashboard(), 'widgets' => [$widget]];
    }

    public function test_tags_folder_and_author_names_are_returned_and_normalized(): void
    {
        $this->actAs('shared.operator@example.test');
        $created = $this->postJson($this->url, [...$this->emptyDashboard(), 'tags' => [' Ops ', 'ops', 'Line 1'], 'folder' => '  Plant A '])
            ->assertOk()
            ->assertJsonPath('data.tags', ['Ops', 'Line 1'])
            ->assertJsonPath('data.folder', 'Plant A')
            ->assertJsonPath('data.starred', false)
            ->assertJsonPath('data.last_viewed_at', null)
            ->assertJsonPath('data.created_by_name', 'Shared Operations Admin')
            ->assertJsonPath('data.updated_by_name', 'Shared Operations Admin')
            ->assertJsonPath('data.created_by', User::where('email', 'shared.operator@example.test')->value('id'))
            ->json('data');
        $this->postJson($this->url, $this->emptyDashboard())->assertOk()->assertJsonPath('data.tags', [])->assertJsonPath('data.folder', null);
        $this->getJson($this->url)->assertOk()->assertJsonPath('data.0.tags', ['Ops', 'Line 1'])->assertJsonPath('data.0.created_by_name', 'Shared Operations Admin');

        $update = [...$this->emptyDashboard(), 'revision' => 1];
        $this->putJson($this->url.'/'.$created['uuid'], $update)->assertOk()->assertJsonPath('data.tags', ['Ops', 'Line 1'])->assertJsonPath('data.folder', 'Plant A');
        $this->putJson($this->url.'/'.$created['uuid'], [...$update, 'revision' => 2, 'folder' => '', 'tags' => []])->assertOk()->assertJsonPath('data.folder', null)->assertJsonPath('data.tags', [])->assertJsonPath('data.revision', 3);

        $invalid = [
            'tags' => [array_map(fn ($i) => 'tag '.$i, range(1, 11)), 'tags'],
            'long tag' => [[str_repeat('a', 33)], 'tags.0'],
            'blank tag' => [['  '], 'tags.0'],
        ];
        foreach ($invalid as [$tags, $error]) {
            $this->postJson($this->url, [...$this->emptyDashboard(), 'tags' => $tags])->assertUnprocessable()->assertJsonValidationErrors($error);
        }
        $this->postJson($this->url, [...$this->emptyDashboard(), 'folder' => str_repeat('f', 61)])->assertUnprocessable()->assertJsonValidationErrors('folder');
    }

    public function test_star_and_last_viewed_are_per_user_and_leave_the_dashboard_unchanged(): void
    {
        $dashboard = $this->postJson($this->url, $this->emptyDashboard())->assertOk()->json('data');
        $path = $this->url.'/'.$dashboard['uuid'];
        $this->putJson($path.'/star', ['starred' => true])->assertOk()->assertJsonPath('data.starred', true)->assertJsonPath('data.revision', 1);
        $this->putJson($path.'/star', ['starred' => 'yes'])->assertUnprocessable()->assertJsonValidationErrors('starred');

        $this->actAs('acme.member@example.test');
        $this->getJson($this->url)->assertOk()->assertJsonPath('data.0.starred', false)->assertJsonPath('data.0.last_viewed_at', null);
        $this->putJson($path.'/star', ['starred' => true])->assertOk()->assertJsonPath('data.starred', true);
        $this->putJson($path.'/star', ['starred' => false])->assertOk()->assertJsonPath('data.starred', false);

        $before = Dashboard::where('uuid', $dashboard['uuid'])->firstOrFail();
        $this->travel(5)->minutes();
        $viewedAt = $this->getJson($path)->assertOk()->assertJsonPath('data.revision', 1)->json('data.last_viewed_at');
        $this->assertSame(now()->startOfSecond()->toJSON(), $viewedAt);
        $after = $before->fresh();
        $this->assertSame(1, $after->revision);
        $this->assertTrue($before->updated_at->equalTo($after->updated_at));
        $this->getJson($this->url)->assertJsonPath('data.0.last_viewed_at', $viewedAt)->assertJsonPath('data.0.starred', false);

        $this->actingAs(User::where('email', 'super-admin@example.test')->firstOrFail(), 'sanctum');
        $this->getJson($this->url)->assertJsonPath('data.0.starred', true)->assertJsonPath('data.0.last_viewed_at', null);
    }

    public function test_duplicate_copies_the_document_into_a_new_dashboard(): void
    {
        $source = $this->source();
        $panel = $this->panel($source);
        $original = $this->postJson($this->url, [...$this->emptyDashboard('Line 1'), 'widgets' => [$panel], 'layouts' => ['lg' => [['i' => $panel['id'], 'x' => 0, 'y' => 0, 'w' => 6, 'h' => 6]]], 'tags' => ['Ops'], 'folder' => 'Plant A'])->assertOk()->json('data');
        $copy = $this->postJson($this->url.'/'.$original['uuid'].'/duplicate', ['name' => ' Line 2 '])
            ->assertOk()
            ->assertJsonPath('data.name', 'Line 2')
            ->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.tags', ['Ops'])
            ->assertJsonPath('data.folder', 'Plant A')
            ->json('data');
        $this->assertNotSame($original['uuid'], $copy['uuid']);
        $this->assertSame($original['widgets'], $copy['widgets']);
        $this->assertSame($original['layouts'], $copy['layouts']);
        $this->assertSame($original['defaults'], $copy['defaults']);
        $this->getJson($this->url.'/'.$copy['uuid'].'/revisions')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.revision', 1);
        $this->postJson($this->url.'/'.$original['uuid'].'/duplicate', ['name' => ''])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson($this->url.'/'.$original['uuid'].'/duplicate', ['name' => str_repeat('n', 121)])->assertUnprocessable()->assertJsonValidationErrors('name');
    }

    public function test_revisions_are_listed_shown_and_restored_with_revision_checks(): void
    {
        $this->actAs('shared.operator@example.test');
        $dashboard = $this->postJson($this->url, [...$this->emptyDashboard('First'), 'tags' => ['Ops']])->assertOk()->json('data');
        $path = $this->url.'/'.$dashboard['uuid'];
        $this->putJson($path, [...$this->emptyDashboard('Second'), 'revision' => 1])->assertOk();
        $this->putJson($path, [...$this->emptyDashboard('Third'), 'revision' => 2, 'tags' => []])->assertOk();

        $this->getJson($path.'/revisions')
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.revision', 3)
            ->assertJsonPath('data.0.name', 'Third')
            ->assertJsonPath('data.2.name', 'First')
            ->assertJsonPath('data.0.widget_count', 0)
            ->assertJsonPath('data.0.updated_by_name', 'Shared Operations Admin');
        $this->getJson($path.'/revisions/1')->assertOk()->assertJsonPath('data.name', 'First')->assertJsonPath('data.tags', ['Ops'])->assertJsonPath('data.widgets', [])->assertJsonPath('data.defaults.refresh', 5);
        $this->getJson($path.'/revisions/99')->assertNotFound();

        $this->postJson($path.'/revisions/1/restore', ['revision' => 3])->assertOk()->assertJsonPath('data.revision', 4)->assertJsonPath('data.name', 'First')->assertJsonPath('data.tags', ['Ops']);
        $this->postJson($path.'/revisions/2/restore', ['revision' => 3])->assertConflict();
        $this->postJson($path.'/revisions/2/restore', [])->assertUnprocessable()->assertJsonValidationErrors('revision');
        $this->postJson($path.'/revisions/99/restore', ['revision' => 4])->assertNotFound();
        $this->getJson($path.'/revisions')->assertJsonCount(4, 'data')->assertJsonPath('data.0.name', 'First');
        $this->getJson($path)->assertJsonPath('data.revision', 4)->assertJsonPath('data.name', 'First');
    }

    public function test_restore_revalidates_sources_that_left_the_organization(): void
    {
        $source = $this->source();
        $panel = $this->panel($source);
        $dashboard = $this->postJson($this->url, $this->widgetPayload($panel))->assertOk()->json('data');
        $path = $this->url.'/'.$dashboard['uuid'];
        $this->putJson($path, [...$this->emptyDashboard(), 'revision' => 1])->assertOk();
        Device::where('uuid', $source['device_uuid'])->update(['organization_id' => Organization::where('slug', 'northstar-utilities')->firstOrFail()->id]);
        // A stale revision is a conflict even when the snapshot would no longer validate.
        $this->postJson($path.'/revisions/1/restore', ['revision' => 1])->assertConflict();
        $this->postJson($path.'/revisions/1/restore', ['revision' => 2])->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config.sources.0');
        $this->getJson($path)->assertJsonPath('data.revision', 2)->assertJsonPath('data.widgets', []);
    }

    public function test_revision_history_keeps_the_latest_fifty(): void
    {
        $dashboard = $this->postJson($this->url, $this->emptyDashboard())->assertOk()->json('data');
        $path = $this->url.'/'.$dashboard['uuid'];
        foreach (range(1, 54) as $revision) {
            $this->putJson($path, [...$this->emptyDashboard('Revision '.($revision + 1)), 'revision' => $revision])->assertOk();
        }
        $this->getJson($path.'/revisions')->assertOk()->assertJsonCount(50, 'data')->assertJsonPath('data.0.revision', 55)->assertJsonPath('data.49.revision', 6);
        $this->assertSame(50, \App\Domain\Dashboards\Models\DashboardRevision::count());
        $this->getJson($path.'/revisions/5')->assertNotFound();
        // A stale revision is a conflict even when the chosen snapshot was pruned by the newer save.
        $this->postJson($path.'/revisions/5/restore', ['revision' => 54])->assertConflict();
        $this->postJson($path.'/revisions/5/restore', ['revision' => 55])->assertNotFound();
    }

    public function test_viewers_read_and_star_but_cannot_change_dashboards(): void
    {
        $dashboard = $this->postJson($this->url, $this->emptyDashboard())->assertOk()->json('data');
        $path = $this->url.'/'.$dashboard['uuid'];
        $this->actAs('acme.member@example.test');
        $this->getJson($this->url)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($path)->assertOk();
        $this->getJson($path.'/revisions')->assertOk();
        $this->getJson($path.'/revisions/1')->assertOk();
        $this->putJson($path.'/star', ['starred' => true])->assertOk();
        $this->postJson($this->url, $this->emptyDashboard())->assertForbidden();
        $this->putJson($path, [...$this->emptyDashboard(), 'revision' => 1])->assertForbidden();
        $this->postJson($path.'/duplicate', ['name' => 'Copy'])->assertForbidden();
        $this->postJson($path.'/revisions/1/restore', ['revision' => 1])->assertForbidden();
        $this->deleteJson($path)->assertForbidden();

        $this->actingAs(User::factory()->create(), 'sanctum');
        $this->getJson($path)->assertForbidden();
        $this->putJson($path.'/star', ['starred' => true])->assertForbidden();
    }

    public function test_dashboards_from_another_organization_are_not_found(): void
    {
        $dashboard = $this->postJson($this->url, $this->emptyDashboard())->assertOk()->json('data');
        $other = '/api/v1/organizations/'.Organization::where('slug', 'northstar-utilities')->firstOrFail()->uuid.'/dashboards/'.$dashboard['uuid'];
        $this->getJson($other)->assertNotFound();
        $this->putJson($other.'/star', ['starred' => true])->assertNotFound();
        $this->postJson($other.'/duplicate', ['name' => 'Copy'])->assertNotFound();
        $this->getJson($other.'/revisions')->assertNotFound();
        $this->getJson($other.'/revisions/1')->assertNotFound();
        $this->postJson($other.'/revisions/1/restore', ['revision' => 1])->assertNotFound();
        $this->assertDatabaseCount('dashboard_user', 0);
    }

    public function test_gauge_and_table_panels_validate_sources_and_range(): void
    {
        $source = $this->source();
        $gauge = ['id' => 'gauge', 'schema_version' => 2, 'type' => 'gauge', 'title' => 'Tank', 'description' => '', 'config' => ['sources' => [$source], 'min' => 0, 'max' => '100']];
        $this->postJson($this->url, $this->widgetPayload($gauge))->assertOk()->assertJsonPath('data.widgets.0.config.min', 0)->assertJsonPath('data.widgets.0.config.max', 100)->assertJsonPath('data.widgets.0.config.sources.0.unit', 'C');
        $cases = [
            'min not below max' => [['min' => 10, 'max' => 10], 'widgets.0.config.max'],
            'missing min' => [['min' => null], 'widgets.0.config.min'],
            'non-numeric max' => [['max' => 'high'], 'widgets.0.config.max'],
            'no sources' => [['sources' => []], 'widgets.0.config'],
            'five sources' => [['sources' => array_map(fn () => $this->source(), range(1, 5))], 'widgets.0.config.sources'],
            'string source' => [['sources' => [[...$this->source('', 'string'), 'thresholds' => []]]], 'widgets.0.config.sources.0'],
            'columns' => [['columns' => 2], 'widgets.0.config'],
            'workflow' => [['workflow_uuid' => (string) Str::uuid()], 'widgets.0.config'],
        ];
        foreach ($cases as $name => [$config, $error]) {
            $this->postJson($this->url, $this->widgetPayload(['id' => 'gauge', ...$gauge, 'config' => [...$gauge['config'], ...$config]]))->assertUnprocessable()->assertJsonValidationErrors($error, 'errors', $name);
        }

        $table = ['id' => 'table', 'schema_version' => 2, 'type' => 'table', 'title' => 'Latest', 'description' => '', 'config' => ['sources' => [$source, [...$this->source('', 'string'), 'thresholds' => []]]]];
        $this->postJson($this->url, $this->widgetPayload($table))->assertOk()->assertJsonCount(2, 'data.widgets.0.config.sources')->assertJsonPath('data.widgets.0.config.sources.1.data_type', 'string');
        $this->postJson($this->url, $this->widgetPayload([...$table, 'config' => ['sources' => []]]))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config');
        $this->postJson($this->url, $this->widgetPayload([...$table, 'config' => ['sources' => [$source], 'min' => 0]]))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config');
        $forged = $this->source();
        $forged['parameter_uuid'] = (string) Str::uuid();
        $this->postJson($this->url, $this->widgetPayload([...$table, 'config' => ['sources' => [$forged]]]))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config.sources.0');
    }

    public function test_text_and_device_health_panels_validate_their_settings(): void
    {
        $text = ['id' => 'notes', 'schema_version' => 2, 'type' => 'text', 'title' => 'Notes', 'description' => '', 'config' => ['sources' => [], 'text' => "Shift notes\nCheck pump 2"]];
        $this->postJson($this->url, $this->widgetPayload($text))->assertOk()->assertJsonPath('data.widgets.0.config.text', "Shift notes\nCheck pump 2")->assertJsonPath('data.widgets.0.config.sources', []);
        $this->postJson($this->url, $this->widgetPayload([...$text, 'config' => ['sources' => [$this->source()], 'text' => 'Notes']]))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config');
        $this->postJson($this->url, $this->widgetPayload([...$text, 'config' => ['sources' => [], 'text' => str_repeat('a', 4001)]]))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config.text');
        $this->postJson($this->url, $this->widgetPayload([...$text, 'config' => ['sources' => []]]))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config.text');
        $this->postJson($this->url, $this->widgetPayload([...$text, 'config' => ['sources' => [], 'text' => 'Notes', 'min' => 0]]))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config');

        $device = Device::create(['organization_id' => $this->organization->id, 'code' => (string) Str::uuid(), 'name' => 'Pump 1']);
        $health = ['id' => 'health', 'schema_version' => 2, 'type' => 'device_health', 'title' => 'Health', 'description' => '', 'config' => ['sources' => [], 'devices' => [['device_uuid' => $device->uuid, 'device_name' => 'Forged']]]];
        $this->postJson($this->url, $this->widgetPayload($health))->assertOk()->assertJsonPath('data.widgets.0.config.devices.0.device_name', 'Pump 1');
        $foreign = Device::create(['organization_id' => Organization::where('slug', 'northstar-utilities')->firstOrFail()->id, 'code' => (string) Str::uuid(), 'name' => 'Other']);
        $cases = [
            'other organization' => [['devices' => [['device_uuid' => $foreign->uuid]]], 'widgets.0.config.devices.0'],
            'unknown device' => [['devices' => [['device_uuid' => (string) Str::uuid()]]], 'widgets.0.config.devices.0'],
            'duplicate device' => [['devices' => [['device_uuid' => $device->uuid], ['device_uuid' => $device->uuid]]], 'widgets.0.config.devices.1'],
            'no devices' => [['devices' => []], 'widgets.0.config.devices'],
            'too many devices' => [['devices' => array_map(fn () => ['device_uuid' => $device->uuid], range(1, 51))], 'widgets.0.config.devices'],
            'sources' => [['sources' => [$this->source()]], 'widgets.0.config'],
        ];
        foreach ($cases as $name => [$config, $error]) {
            $this->postJson($this->url, $this->widgetPayload([...$health, 'config' => [...$health['config'], ...$config]]))->assertUnprocessable()->assertJsonValidationErrors($error, 'errors', $name);
        }

        $status = $this->panel($this->source());
        $status['config']['text'] = 'Not for status panels';
        $this->postJson($this->url, $this->widgetPayload($status))->assertUnprocessable()->assertJsonValidationErrors('widgets.0.config');
    }
}
