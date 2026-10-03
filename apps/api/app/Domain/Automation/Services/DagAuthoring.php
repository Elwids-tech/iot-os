<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class DagAuthoring
{
    public function compile(Organization $org, array $graph, string $uuid, ?string $version = null): array
    {
        validator(['workflow' => $graph], [
            'workflow' => 'required|array:schema_version,uuid,version_uuid,organization_uuid,bindings,nodes,edges',
            'workflow.schema_version' => 'required|in:automation-workflow.v2', 'workflow.bindings' => 'present|array|max:32',
            'workflow.bindings.*' => 'required|array:role,device_uuid,configuration_uuid,generation,parameter_uuid,data_type,unit,fresh_seconds',
            'workflow.bindings.*.device_uuid' => 'required|uuid', 'workflow.bindings.*.configuration_uuid' => 'required|uuid', 'workflow.bindings.*.parameter_uuid' => 'required|uuid',
            'workflow.nodes' => 'required|array|min:2|max:100', 'workflow.edges' => 'present|array|max:200',
        ])->validate();
        abort_if(strlen(json_encode($graph, JSON_THROW_ON_ERROR)) > 262144, 422, 'Workflow is too large.');
        $graph['uuid'] = $uuid;
        $graph['version_uuid'] = $version ?? (string) Str::uuid();
        $graph['organization_uuid'] = $org->uuid;
        foreach ($graph['bindings'] as $binding) {
            $device = Device::where('organization_id', $org->id)->where('uuid', $binding['device_uuid'])->firstOrFail();
            $configuration = $device->configurations()->where('uuid', $binding['configuration_uuid'])->firstOrFail();
            $profile = json_decode($configuration->definition['profile_canonical_json'], true, 512, JSON_THROW_ON_ERROR);
            abort_unless(collect($profile['parameters'])->contains('uuid', $binding['parameter_uuid']), 422, 'Parameter does not belong to this configuration.');
        }
        foreach ($graph['nodes'] as &$node) {
            if (($node['config'] ?? null) === []) {
                $node['config'] = (object) [];
            }
        } unset($node);

        return app(RuntimeClient::class)->request('POST', '/internal/dag/compile', ['workflow' => $graph]);
    }

    public function save(Organization $org, array $input, int $actor, ?Workflow $workflow = null): Workflow
    {
        $compiled = $this->compile($org, $input['workflow'], $workflow?->uuid ?? (string) Str::uuid());
        if (! ($compiled['valid'] ?? false)) {
            throw ValidationException::withMessages(['workflow' => array_map(fn ($d) => ($d['node_id'] ?? 'graph').': '.$d['message'], $compiled['diagnostics'] ?? [])]);
        }

        return DB::transaction(function () use ($org, $input, $actor, $workflow, $compiled) {
            if ($workflow) {
                $workflow = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
                abort_unless($workflow->draft_revision === ($input['draft_revision'] ?? null), 409, 'The draft changed; your local edits have not been saved.');
            } else {
                $workflow = new Workflow(['uuid' => $compiled['definition']['uuid'], 'organization_id' => $org->id, 'draft_revision' => 0]);
            }
            $workflow->fill(['name' => $input['name'], 'workflow' => $compiled['definition'], 'definition' => $compiled['definition'], 'definition_hash' => $compiled['definition_hash'], 'draft_revision' => $workflow->draft_revision + 1, 'updated_by' => $actor])->save();
            // Hydrate database defaults before returning the initial draft. The
            // editor immediately uses layout_revision for its independent save.
            $workflow->refresh();
            DB::table('automation_workflow_revisions')->insert(['automation_workflow_id' => $workflow->id, 'revision' => $workflow->draft_revision, 'snapshot' => json_encode($workflow->toArray(), JSON_THROW_ON_ERROR), 'created_by' => $actor, 'created_at' => now()]);
            DeviceAudit::record('workflow.draft_saved', $org->id, $actor, $workflow->uuid, ['revision' => $workflow->draft_revision, 'definition_hash' => $workflow->definition_hash]);

            return $workflow;
        });
    }
}
