<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagAuthoring;
use App\Domain\Automation\Services\DagAuthorization;
use App\Domain\Automation\Services\DagDeployment;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class DagController
{
    public function __construct(private readonly DagAuthorization $auth, private readonly DagAuthoring $authoring, private readonly RuntimeClient $runtime) {}

    public function registry(Request $r, Organization $organization): array
    {
        $this->auth->authorize($r->user(), $organization, 'view');
        $this->auth->enabled($organization);

        return ['data' => $this->runtime->request('GET', '/internal/dag/node-types')];
    }

    public function validateGraph(Request $r, Organization $organization): array
    {
        $this->auth->authorize($r->user(), $organization, 'manage');
        $this->auth->enabled($organization);
        $v = $r->validate(['workflow' => 'required|array']);

        return $this->authoring->compile($organization, $v['workflow'], (string) Str::uuid());
    }

    public function store(Request $r, Organization $organization)
    {
        $this->auth->authorize($r->user(), $organization, 'manage');
        $this->auth->enabled($organization);
        $v = $r->validate(['name' => 'required|string|max:255', 'workflow' => 'required|array']);

        return response()->json(['data' => $this->view($this->authoring->save($organization, $v, $r->user()->id))], 201);
    }

    public function update(Request $r, Organization $organization, Workflow $workflow): array
    {
        $this->auth->authorize($r->user(), $organization, 'manage', $workflow);
        $this->auth->enabled($organization);
        $v = $r->validate(['name' => 'required|string|max:255', 'workflow' => 'required|array', 'draft_revision' => 'required|integer|min:1']);

        return ['data' => $this->view($this->authoring->save($organization, $v, $r->user()->id, $workflow))];
    }

    public function show(Request $r, Organization $organization, Workflow $workflow): array
    {
        $this->auth->authorize($r->user(), $organization, 'view', $workflow);

        return ['data' => $this->view($workflow)];
    }

    public function index(Request $r, Organization $organization): array
    {
        $this->auth->authorize($r->user(), $organization, 'view');
        $r->validate(['page' => 'sometimes|integer|min:1', 'search' => 'sometimes|nullable|string|max:255']);
        $p = Workflow::where('organization_id', $organization->id)->where('workflow->schema_version', 'automation-workflow.v2')->when($r->filled('search'), fn ($q) => $q->where('name', 'like', '%'.$r->string('search').'%'))->orderByDesc('id')->paginate(25);

        return ['data' => $p->getCollection()->map(fn ($w) => $this->view($w)), 'meta' => ['current_page' => $p->currentPage(), 'last_page' => $p->lastPage(), 'total' => $p->total()]];
    }

    public function layout(Request $r, Organization $organization, Workflow $workflow): array
    {
        $this->auth->authorize($r->user(), $organization, 'manage', $workflow);
        $v = $r->validate(['layout_revision' => 'required|integer|min:0', 'layout' => 'required|array:positions,viewport', 'layout.positions' => 'present|array|max:100', 'layout.positions.*' => 'array:x,y', 'layout.positions.*.x' => 'required|numeric|between:-100000,100000', 'layout.positions.*.y' => 'required|numeric|between:-100000,100000', 'layout.viewport' => 'sometimes|array:x,y,zoom', 'layout.viewport.x' => 'required_with:layout.viewport|numeric', 'layout.viewport.y' => 'required_with:layout.viewport|numeric', 'layout.viewport.zoom' => 'required_with:layout.viewport|numeric|between:0.1,4']);

        return DB::transaction(function () use ($workflow, $v) {
            $w = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
            abort_unless($w->layout_revision === $v['layout_revision'], 409, 'Layout changed.');
            $w->update(['layout' => $v['layout'], 'layout_revision' => $w->layout_revision + 1]);

            return ['data' => $this->view($w)];
        });
    }

    public function simulate(Request $r, Organization $organization, Workflow $workflow): array
    {
        $this->auth->authorize($r->user(), $organization, 'manage', $workflow);
        $this->auth->enabled($organization);
        $v = $r->validate(['draft_revision' => 'required|integer|min:1', 'steps' => 'required|array|min:1|max:1000', 'steps.*' => 'array:at,event', 'steps.*.at' => 'required|date', 'steps.*.event' => 'nullable|array']);
        abort_unless($v['draft_revision'] === $workflow->draft_revision, 409, 'Draft changed.');
        foreach ($v['steps'] as $step) {
            if ($event = $step['event'] ?? null) {
                abort_unless(($event['organization_uuid'] ?? null) === $organization->uuid && collect($workflow->workflow['bindings'])->contains('device_uuid', $event['device_uuid'] ?? null), 422, 'Simulation event is outside this workflow.');
            }
        }

        return [...$this->runtime->request('POST', '/internal/dag/simulate', ['workflow' => $workflow->workflow, 'steps' => $v['steps']]), 'draft_revision' => $workflow->draft_revision];
    }

    public function deploy(Request $r, Organization $organization, Workflow $workflow)
    {
        $this->auth->authorize($r->user(), $organization, 'activate', $workflow);
        $v = $r->validate(['operation_uuid' => 'required|uuid', 'target_state' => 'required|in:active,inactive', 'draft_revision' => 'required|integer|min:1', 'expected_generation' => 'required|integer|min:0', 'command_grants' => 'sometimes|array|max:100']);
        $d = app(DagDeployment::class)->request($workflow, $v, $r->user());

        return response()->json(['data' => $this->view($workflow->fresh()), 'deployment' => $d], 202);
    }

    public function execution(Request $r, Organization $organization, Workflow $workflow): array
    {
        $this->auth->authorize($r->user(), $organization, 'view', $workflow);

        return ['data' => $workflow->applied_deployment_uuid ? $this->runtime->request('GET', '/internal/dag/execution', ['operation_uuid' => $workflow->applied_deployment_uuid, 'organization_uuid' => $organization->uuid]) : null];
    }

    public function history(Request $r, Organization $organization, Workflow $workflow): array
    {
        $this->auth->authorize($r->user(), $organization, 'view', $workflow);
        $p = DB::table('automation_actions')->whereIn('automation_deployment_id', DB::table('automation_deployments')->where('automation_workflow_id', $workflow->id)->select('id'))->orderByDesc('created_at')->paginate(25);

        return ['data' => $p->items(), 'meta' => ['current_page' => $p->currentPage(), 'last_page' => $p->lastPage(), 'total' => $p->total()]];
    }

    public function timeline(Request $r, Organization $organization, Workflow $workflow, ?string $evaluation = null): array
    {
        $this->auth->authorize($r->user(), $organization, 'view', $workflow);
        abort_unless(($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2', 422, 'Execution timelines require a v2 workflow.');
        $input = $r->validate(['before' => 'sometimes|integer|min:1|max:9223372036854775807']);
        if ($evaluation !== null) {
            validator(['evaluation' => $evaluation], ['evaluation' => 'required|integer|min:1|max:9223372036854775807'])->validate();
        }
        return app(\App\Domain\Automation\Services\DagTimeline::class)->read($organization, $workflow, isset($input['before']) ? (string) $input['before'] : null, $evaluation);
    }

    public function settings(Request $r, Organization $organization): array
    {
        $this->auth->authorize($r->user(), $organization, $r->isMethod('PUT') ? 'activate' : 'view');
        DB::table('automation_settings')->insertOrIgnore(['organization_id' => $organization->id]);
        if ($r->isMethod('PUT')) {
            $v = $r->validate(['revision' => 'required|integer|min:0', 'enabled' => 'required|boolean', 'stopped' => 'required|boolean']);
            DB::transaction(function () use ($organization, $v, $r) {
                $q = DB::table('automation_settings')->where('organization_id', $organization->id);
                $s = (clone $q)->lockForUpdate()->first();
                abort_unless($s->revision === $v['revision'], 409, 'Settings changed.');
                $q->update([...$v, 'revision' => $s->revision + 1]);
                if (! $v['enabled'] || $v['stopped']) {
                    DB::table('automation_actions')->where('organization_id', $organization->id)->where('status', 'accepted')->update(['status' => 'cancelled', 'diagnostic' => 'Organization automation stopped.', 'updated_at' => now()]);
                }DeviceAudit::record('automation.settings_changed', $organization->id, $r->user()->id, null, $v);
            });
        }
        $settings = (array) DB::table('automation_settings')->where('organization_id', $organization->id)->first();
        $settings['enabled'] = (bool) $settings['enabled'];
        $settings['stopped'] = (bool) $settings['stopped'];

        return ['data' => $settings];
    }

    public function resources(Request $r, Organization $organization): array
    {
        $this->auth->authorize($r->user(), $organization, 'view');
        $r->validate(['search' => 'sometimes|nullable|string|max:255', 'page' => 'sometimes|integer|min:1', 'controllable' => 'sometimes|boolean', 'device_uuid' => 'sometimes|uuid']);
        $controllable = $r->boolean('controllable');
        $query = Device::where('organization_id', $organization->id)->whereNotNull('applied_configuration_uuid')
            ->when($r->filled('search'), fn ($q) => $q->where('name', 'like', '%'.$r->string('search').'%'))
            ->when($r->filled('device_uuid'), fn ($q) => $q->where('uuid', $r->string('device_uuid')));
        if ($controllable) {
            app(DeviceAuthorization::class)->authorize($r->user(), DevicePermission::COMMAND, $organization);
            // Filter before pagination, including the applied mapping rather than just profile capability.
            $query->where('lifecycle', 'active')->where('deployment_status', 'applied')->whereHas('configurations', function ($q) {
                $q->whereColumn('device_configurations.uuid', 'devices.applied_configuration_uuid');
                if (DB::connection()->getDriverName() === 'pgsql') {
                    $q->whereRaw("EXISTS (SELECT 1 FROM jsonb_array_elements((definition->>'profile_canonical_json')::jsonb->'parameters') p, jsonb_array_elements(definition->'mappings') m WHERE p->>'uuid' = m->>'parameter_uuid' AND p->>'accepts_command' = 'true' AND p->>'reports_state' = 'true' AND COALESCE(m->>'command_metric', '') <> '')");
                } else {
                    $q->whereRaw("EXISTS (SELECT 1 FROM json_each(json_extract(definition, '$.profile_canonical_json'), '$.parameters') p, json_each(definition, '$.mappings') m WHERE json_extract(p.value, '$.uuid') = json_extract(m.value, '$.parameter_uuid') AND json_extract(p.value, '$.accepts_command') = 1 AND json_extract(p.value, '$.reports_state') = 1 AND COALESCE(json_extract(m.value, '$.command_metric'), '') <> '')");
                }
            });
        }
        $page = $query->orderBy('id')->paginate(25, ['*'], 'page', $r->integer('page', 1));
        return ['data' => $page->getCollection()->map(function ($device) use ($controllable) {
            $c = $device->configurations()->where('uuid', $device->applied_configuration_uuid)->first();
            $p = $c ? json_decode($c->definition['profile_canonical_json'], true) : [];
            $parameters = collect($p['parameters'] ?? [])->filter(function ($p) use ($c, $controllable) {
                $mapping = collect($c->definition['mappings'] ?? [])->firstWhere('parameter_uuid', $p['uuid']);
                return $mapping && (! $controllable || (($p['accepts_command'] ?? false) && ($p['reports_state'] ?? false) && ($mapping['command_metric'] ?? null)));
            })->values();
            return ['device_uuid' => $device->uuid, 'name' => $device->name, 'configuration_uuid' => $device->applied_configuration_uuid, 'generation' => $device->deployment_generation, 'parameters' => $parameters];
        }), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function health(Request $r, Organization $organization): array
    {
        $this->auth->authorize($r->user(), $organization, 'view');

        return ['data' => [...$this->runtime->request('GET', '/internal/dag/health', ['organization_uuid' => $organization->uuid]), 'actions' => DB::table('automation_actions')->where('organization_id', $organization->id)->selectRaw('status, count(*) as count')->groupBy('status')->pluck('count', 'status')]];
    }

    public function reconcile(Request $r, Organization $organization, string $command): array
    {
        $this->auth->authorize($r->user(), $organization, 'activate');
        $v = $r->validate(['note' => 'required|string|min:10|max:2000', 'confirmed' => 'required|accepted']);

        return DB::transaction(function () use ($r, $organization, $command, $v) {
            $c = DeviceCommand::where('uuid', $command)->firstOrFail();
            $device = Device::where('organization_id', $organization->id)->whereKey($c->device_id)->lockForUpdate()->firstOrFail();
            app(DeviceAuthorization::class)->authorize($r->user(), DevicePermission::COMMAND, $organization, $device);
            abort_unless(in_array($c->status, ['uncertain', 'timed_out'], true), 409, 'This command does not require reconciliation.');
            $check = $this->runtime->request('POST', '/internal/command-check', ['organization_uuid' => $organization->uuid, 'device_uuid' => $device->uuid, 'configuration_uuid' => $c->configuration->uuid, 'parameter_uuid' => $c->parameter_uuid, 'value' => $c->value]);
            abort_unless($check['already_at_target'] ?? false, 409, 'A fresh reported target state is required to reconcile this command.');
            DB::table('automation_command_reconciliations')->insertOrIgnore(['command_uuid' => $c->uuid, 'user_id' => $r->user()->id, 'note' => $v['note'], 'created_at' => now()]);
            DB::table('automation_command_targets')->where('device_id', $device->id)->where('parameter_uuid', $c->parameter_uuid)->where('uncertain_command_uuid', $c->uuid)->update(['uncertain_command_uuid' => null]);
            DeviceAudit::record('automation.command_reconciled', $organization->id, $r->user()->id, $c->uuid, ['note' => $v['note']]);

            return ['data' => ['command_uuid' => $c->uuid, 'reconciled' => true]];
        });
    }

    public function view(Workflow $w): array
    {
        $deployment = DB::table('automation_deployments')->where('automation_workflow_id', $w->id)->orderByDesc('generation')->first();

        return [...$w->only(['uuid', 'name', 'draft_revision', 'workflow', 'definition_hash', 'layout', 'layout_revision', 'deployment_generation', 'deployment_status', 'desired_deployment_uuid', 'applied_deployment_uuid', 'pending_operation_uuid']), 'deployment_diagnostic' => $deployment?->diagnostic];
    }
}
