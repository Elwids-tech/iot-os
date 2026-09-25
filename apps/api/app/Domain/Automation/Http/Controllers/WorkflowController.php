<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
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
        $request->validate(['page' => ['sometimes', 'integer', 'min:1'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:100']]);
        $page = Workflow::where('organization_id', $organization->id)->orderBy('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($w) => $this->view($w)), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function show(Request $request, Organization $organization, Workflow $workflow): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization, $workflow);

        return ['data' => $this->view($workflow)];
    }

    public function store(Request $request, Organization $organization)
    {
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

    private function view(Workflow $workflow): array
    {
        $graph = $workflow->workflow;
        foreach ($graph['nodes'] as &$node) {
            if ($node['config'] === []) {
                $node['config'] = (object) [];
            }
        }

        return ['uuid' => $workflow->uuid, 'name' => $workflow->name, 'status' => 'draft', 'draft_revision' => $workflow->draft_revision, 'workflow' => $graph, 'definition_hash' => $workflow->definition_hash];
    }
}
