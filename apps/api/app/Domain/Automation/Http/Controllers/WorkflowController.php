<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\DagAuthorization;
use App\Domain\Automation\Services\WorkflowDeploymentService;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

final class WorkflowController
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly RuntimeClient $runtime) {}

    public function nodeTypes(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);

        return ['data' => $this->runtime->request('GET', '/internal/rules/node-types')];
    }

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);
        $request->validate(['page' => ['sometimes', 'integer', 'min:1'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'], 'search' => ['sometimes', 'nullable', 'string', 'max:255'], 'kind' => ['sometimes', 'in:geofence,all']]);
        // Geofence (v1) workflows unless the caller opts into DAG automations (v2) with kind=all.
        $versions = $request->input('kind') === 'all' ? ['automation-workflow.v1', 'automation-workflow.v2'] : ['automation-workflow.v1'];
        $page = Workflow::where('organization_id', $organization->id)->whereIn('workflow->schema_version', $versions)->when($request->filled('search'), fn ($query) => $query->where('name', 'like', '%'.$request->string('search').'%'))->orderBy('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($w) => [...$this->view($w), 'kind' => $w->kind()]), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function show(Request $request, Organization $organization, Workflow $workflow): array
    {
        if (($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2') {
            return app(DagController::class)->show($request, $organization, $workflow);
        }
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $workflow);

        return ['data' => $this->view($workflow)];
    }

    public function store(Request $request, Organization $organization)
    {
        if ($request->input('workflow.schema_version') === 'automation-workflow.v2') {
            return app(DagController::class)->store($request, $organization);
        }
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $values = $this->compile($request, $organization, (string) Str::uuid());
        $workflow = DB::transaction(function () use ($values, $request, $organization) {
            $workflow = Workflow::create([...$values, 'uuid' => $values['workflow']['uuid'], 'organization_id' => $organization->id, 'draft_revision' => 1, 'updated_by' => $request->user()->id]);
            $this->record($workflow, $request->user()->id);

            return $workflow;
        });

        return response()->json(['data' => $this->view($workflow)], 201);
    }

    public function update(Request $request, Organization $organization, Workflow $workflow): array
    {
        if (($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2') {
            return app(DagController::class)->update($request, $organization, $workflow);
        }
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $workflow);
        $revision = $request->validate(['draft_revision' => ['required', 'integer', 'min:1']])['draft_revision'];
        abort_unless($workflow->draft_revision === $revision, 409, 'The workflow draft has changed. Reload before editing.');
        $values = $this->compile($request, $organization, $workflow->uuid);
        $workflow = DB::transaction(function () use ($workflow, $values, $revision, $request) {
            $locked = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->draft_revision === $revision, 409, 'The workflow draft has changed. Reload before editing.');
            $locked->fill([...$values, 'draft_revision' => $revision + 1, 'updated_by' => $request->user()->id])->save();
            $this->record($locked, $request->user()->id);

            return $locked;
        });

        return ['data' => $this->view($workflow)];
    }

    private function compile(Request $request, Organization $organization, string $uuid): array
    {
        $input = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'workflow' => ['required', 'array:schema_version,uuid,version_uuid,nodes,edges'],
            'workflow.schema_version' => ['required', 'in:automation-workflow.v1'],
            'workflow.nodes' => ['required', 'array', 'size:4'],
            'workflow.nodes.*' => ['required', 'array:id,type,config'],
            'workflow.nodes.*.id' => ['required', 'string', 'max:64', 'distinct'],
            'workflow.nodes.*.type' => ['required', 'string', 'max:64', 'distinct'],
            'workflow.nodes.*.config' => ['present', 'array'],
            'workflow.edges' => ['required', 'array', 'size:3'],
            'workflow.edges.*' => ['required', 'array:source,target'],
            'workflow.edges.*.source' => ['required', 'string', 'max:64'],
            'workflow.edges.*.target' => ['required', 'string', 'max:64'],
        ]);
        $graph = $input['workflow'];
        abort_if(strlen(json_encode($graph, JSON_THROW_ON_ERROR)) > 262144, 422, 'Workflow is too large.');
        $source = collect($graph['nodes'])->firstWhere('type', 'location.source.v1');
        $binding = $source['config']['binding'] ?? [];
        abort_unless(is_array($binding), 422, 'Location binding must be an object.');
        Validator::make($binding, [
            'organization_uuid' => ['required', 'uuid'],
            'device_uuid' => ['required', 'uuid'],
            'configuration_uuid' => ['required', 'uuid'],
        ])->validate();
        abort_unless(($binding['organization_uuid'] ?? null) === $organization->uuid, 422, 'Location binding must belong to this organization.');
        $device = Device::where('organization_id', $organization->id)->where('uuid', $binding['device_uuid'] ?? '')->firstOrFail();
        abort_unless($device->configurations()->where('uuid', $binding['configuration_uuid'] ?? '')->exists(), 422, 'Select a configuration belonging to this device.');
        $graph['uuid'] = $uuid;
        $graph['version_uuid'] = (string) Str::uuid();
        // PHP decodes an empty JSON object to []; restore it for strict Go configs.
        foreach ($graph['nodes'] as &$node) {
            if ($node['config'] === []) {
                $node['config'] = (object) [];
            }
        }
        unset($node);
        $compiled = $this->runtime->request('POST', '/internal/workflows/compile', ['workflow' => $graph]);
        abort_unless(($compiled['valid'] ?? false) && isset($compiled['definition'], $compiled['definition_hash']), 503, 'The runtime did not return a compiled workflow.');

        return ['name' => $input['name'], 'workflow' => $graph, 'definition' => $compiled['definition'], 'definition_hash' => $compiled['definition_hash']];
    }

    public function simulate(Request $request, Organization $organization, Workflow $workflow): array
    {
        if (($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2') {
            return app(DagController::class)->simulate($request, $organization, $workflow);
        }
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $workflow);
        $input = $request->validate(['draft_revision' => ['required', 'integer', 'min:1'], 'steps' => ['required', 'array', 'min:1', 'max:1000'], 'steps.*' => ['required', 'array:at,event'], 'steps.*.at' => ['required', 'date'], 'steps.*.event' => ['nullable', 'array']]);
        abort_unless($input['draft_revision'] === $workflow->draft_revision, 409, 'The workflow draft has changed. Reload before simulating.');
        abort_if(strlen(json_encode($input, JSON_THROW_ON_ERROR)) > 3 * 1024 * 1024, 422, 'Simulation is too large.');
        $binding = $workflow->definition['binding'];
        foreach ($input['steps'] as $step) {
            if (($step['event'] ?? null) !== null) {
                abort_unless(($step['event']['organization_uuid'] ?? null) === $organization->uuid && ($step['event']['device_uuid'] ?? null) === $binding['device_uuid'], 422, 'Simulation events must belong to the bound device and organization.');
            }
        }

        return [...$this->runtime->request('POST', '/internal/rules/simulate', ['definition' => $workflow->definition, 'steps' => $input['steps']]), 'draft_revision' => $workflow->draft_revision, 'mode' => 'side-effect-free'];
    }

    private function record(Workflow $workflow, int $actor): void
    {
        DB::table('automation_workflow_revisions')->insert(['automation_workflow_id' => $workflow->id, 'revision' => $workflow->draft_revision, 'snapshot' => json_encode($this->view($workflow), JSON_THROW_ON_ERROR), 'created_by' => $actor, 'created_at' => now()]);
        DeviceAudit::record('workflow.draft_saved', $workflow->organization_id, $actor, $workflow->uuid, ['revision' => $workflow->draft_revision, 'definition_hash' => $workflow->definition_hash]);
    }

    public function deploy(Request $request, Organization $organization, Workflow $workflow)
    {
        if (($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2') {
            return app(DagController::class)->deploy($request, $organization, $workflow);
        }
        $this->authorization->authorize($request->user(), DevicePermission::ACTIVATE, $organization, $workflow);
        $input = $request->validate(['operation_uuid' => ['required', 'uuid'], 'target_state' => ['required', 'in:active,inactive'], 'draft_revision' => ['required', 'integer', 'min:1'], 'expected_generation' => ['required', 'integer', 'min:0']]);
        $deployment = app(WorkflowDeploymentService::class)->request($workflow, $input, $request->user()->id);

        return response()->json(['data' => $this->view($workflow->fresh()), 'deployment' => $this->deploymentView($deployment)], 202);
    }

    public function deployment(Request $request, Organization $organization, Workflow $workflow, string $operation): array
    {
        if (($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2') {
            app(DagAuthorization::class)->authorize($request->user(), $organization, 'view', $workflow);
            $deployment = Deployment::where('automation_workflow_id', $workflow->id)->where('uuid', $operation)->firstOrFail();

            return ['data' => app(DagController::class)->view($workflow), 'deployment' => $this->deploymentView($deployment)];
        }

        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $workflow);
        validator(['operation' => $operation], ['operation' => 'required|uuid'])->validate();
        $deployment = Deployment::where('automation_workflow_id', $workflow->id)->where('uuid', $operation)->firstOrFail();

        return ['data' => $this->view($workflow), 'deployment' => $this->deploymentView($deployment)];
    }

    public function transitions(Request $request, Organization $organization, Workflow $workflow): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $workflow);
        $request->validate(['page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $page = DB::table('automation_transitions')->whereIn('automation_deployment_id', Deployment::where('automation_workflow_id', $workflow->id)->select('id'))->orderByDesc('received_at')->orderBy('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($row) => json_decode($row->transition, true)), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    private function deploymentView(Deployment $deployment): array
    {
        return $deployment->only(['uuid', 'generation', 'draft_revision', 'target', 'definition_hash', 'status', 'stopped_reason', 'diagnostic', 'created_at', 'completed_at']);
    }

    public function execution(Request $request, Organization $organization, Workflow $workflow): array
    {
        if (($workflow->workflow['schema_version'] ?? '') === 'automation-workflow.v2') {
            return app(DagController::class)->execution($request, $organization, $workflow);
        }
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $workflow);
        if (! $workflow->applied_deployment_uuid) {
            return ['data' => null];
        }

        return ['operation_uuid' => $workflow->applied_deployment_uuid, 'data' => $this->runtime->request('GET', '/internal/workflows/execution', ['operation_uuid' => $workflow->applied_deployment_uuid, 'organization_uuid' => $organization->uuid])];
    }

    public function locationOverview(Request $request, Organization $organization, Workflow $workflow): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $workflow);
        $data = null;
        if ($workflow->applied_deployment_uuid) {
            $version = Deployment::where('automation_workflow_id', $workflow->id)->where('uuid', $workflow->applied_deployment_uuid)->firstOrFail();
            Device::where('organization_id', $organization->id)->where('uuid', $version->definition['binding']['device_uuid'] ?? '')->firstOrFail();
            $data = $this->runtime->request('GET', '/internal/workflows/location-overview', [
                'operation_uuid' => $workflow->applied_deployment_uuid, 'organization_uuid' => $organization->uuid,
                'retention_days' => app(RetentionService::class)->effective($organization)['days'],
            ]);
        }

        return ['data' => ['workflow_uuid' => $workflow->uuid, 'workflow_name' => $workflow->name,
            'deployment_status' => $workflow->deployment_status ?? 'inactive', 'operation_uuid' => $workflow->applied_deployment_uuid,
            'snapshot' => $data]];
    }

    public function alertOverview(Request $request, Organization $organization, Workflow $workflow): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $workflow);
        $query = Alert::where('organization_id', $organization->id)->where('automation_workflow_id', $workflow->id);
        $counts = (clone $query)->selectRaw('COUNT(*) as total, SUM(CASE WHEN cleared_at IS NULL THEN 1 ELSE 0 END) as active, SUM(CASE WHEN cleared_at IS NULL AND acknowledged_at IS NULL THEN 1 ELSE 0 END) as unacknowledged')->first();

        return ['data' => ['workflow_uuid' => $workflow->uuid, 'workflow_name' => $workflow->name, 'checked_at' => now()->toIso8601String(),
            'active' => (int) $counts->active,
            'unacknowledged_active' => (int) $counts->unacknowledged,
            'total' => (int) $counts->total,
            'recent' => $query->orderByDesc('id')->limit(10)->get()->map(fn ($alert) => $alert->only(['uuid', 'episode', 'activated_at', 'cleared_at', 'acknowledged_at'])),
        ]];
    }

    private function view(Workflow $workflow): array
    {
        $graph = $workflow->workflow;
        foreach ($graph['nodes'] as &$node) {
            if (($node['config'] ?? null) === []) {
                $node['config'] = (object) [];
            }
        }

        return ['uuid' => $workflow->uuid, 'name' => $workflow->name, 'status' => 'draft', 'draft_revision' => $workflow->draft_revision, 'workflow' => $graph, 'definition_hash' => $workflow->definition_hash, 'deployment_generation' => $workflow->deployment_generation ?? 0, 'deployment_status' => $workflow->deployment_status ?? 'inactive', 'desired_deployment_uuid' => $workflow->desired_deployment_uuid, 'applied_deployment_uuid' => $workflow->applied_deployment_uuid, 'pending_operation_uuid' => $workflow->pending_operation_uuid];
    }
}
