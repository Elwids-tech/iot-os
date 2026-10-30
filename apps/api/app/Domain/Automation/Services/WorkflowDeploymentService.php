<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Geospatial\Services\GeofenceEventJournal;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;

final class WorkflowDeploymentService
{
    public function request(Workflow $workflow, array $input, ?int $actor): Deployment
    {
        return DB::transaction(function () use ($workflow, $input, $actor): Deployment {
            $workflow = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
            $existing = Deployment::where('uuid', $input['operation_uuid'])->first();
            if ($existing) {
                abort_unless($existing->automation_workflow_id === $workflow->id && $existing->generation === $input['expected_generation'] + 1 && $existing->draft_revision === $input['draft_revision'] && $existing->target === $input['target_state'], 409, 'Operation identity was already used for another request.');

                return $existing;
            }
            abort_unless($workflow->deployment_generation === $input['expected_generation'] && $workflow->draft_revision === $input['draft_revision'], 409, 'Workflow changed. Reload before deploying.');
            abort_if($workflow->pending_operation_uuid !== null, 409, 'Wait for the pending deployment.');
            $definition = null;
            $hash = null;
            if ($input['target_state'] === 'active') {
                $binding = $workflow->definition['binding'];
                $device = Device::where('organization_id', $workflow->organization_id)->where('uuid', $binding['device_uuid'])->lockForUpdate()->firstOrFail();
                abort_unless($device->lifecycle === 'active' && $device->deployment_status === 'applied' && $device->applied_configuration_uuid === $binding['configuration_uuid'] && $device->deployment_generation === $binding['generation'], 422, 'Activate against the currently applied device configuration and generation.');
                $graph = $workflow->workflow;
                $graph['version_uuid'] = $input['operation_uuid'];
                foreach ($graph['nodes'] as &$node) {
                    if ($node['config'] === []) {
                        $node['config'] = (object) [];
                    }
                }
                unset($node);
                $compiled = app(RuntimeClient::class)->request('POST', '/internal/workflows/compile', ['workflow' => $graph]);
                abort_unless(($compiled['valid'] ?? false) && isset($compiled['definition'], $compiled['definition_hash']), 503, 'The runtime did not compile the activation snapshot.');
                $definition = $compiled['definition'];
                $hash = $compiled['definition_hash'];
            }
            $deployment = Deployment::create(['uuid' => $input['operation_uuid'], 'automation_workflow_id' => $workflow->id, 'generation' => $workflow->deployment_generation + 1, 'draft_revision' => $workflow->draft_revision, 'target' => $input['target_state'], 'definition' => $definition, 'definition_hash' => $hash, 'status' => 'pending', 'created_by' => $actor, 'created_at' => now()]);
            $workflow->update(['deployment_generation' => $deployment->generation, 'deployment_status' => 'pending', 'pending_operation_uuid' => $deployment->uuid, 'desired_deployment_uuid' => $deployment->target === 'active' ? $deployment->uuid : null]);
            DeviceAudit::enqueue('workflow.deploy.v1', ['operation_uuid' => $deployment->uuid, 'rule_uuid' => $workflow->uuid, 'organization_uuid' => Organization::findOrFail($workflow->organization_id)->uuid, 'generation' => $deployment->generation, 'target' => $deployment->target, 'definition' => $definition]);
            DeviceAudit::record('workflow.deployment_requested', $workflow->organization_id, $actor, $workflow->uuid, ['operation_uuid' => $deployment->uuid, 'generation' => $deployment->generation, 'target' => $deployment->target]);

            return $deployment;
        });
    }

    // Called inside the existing runtime inbox transaction: projection and inbox
    // deduplication commit together. Historical transitions remain queryable.
    public function event(string $type, array $payload): void
    {
        validator($payload, ['rule_uuid' => 'required|uuid', 'organization_uuid' => 'required|uuid', 'operation_uuid' => 'required|uuid'])->validate();
        $org = Organization::where('uuid', $payload['organization_uuid'])->firstOrFail();
        $workflow = Workflow::where('organization_id', $org->id)->where('uuid', $payload['rule_uuid'])->lockForUpdate()->firstOrFail();
        $deployment = Deployment::where('automation_workflow_id', $workflow->id)->where('uuid', $payload['operation_uuid'])->lockForUpdate()->firstOrFail();
        if ($type === 'workflow.membership.v1') {
            validator($payload, ['transition' => 'required|array', 'transition.id' => 'required|string|size:64',
                'transition.type' => 'required|in:entered,exited', 'transition.definition_hash' => 'required|string|size:64',
                'transition.episode' => 'required|integer|min:0', 'transition.occurred_at' => 'required|date'])->validate();
            $transition = $payload['transition'];
            abort_unless($deployment->target === 'active' && ($transition['rule_uuid'] ?? null) === $workflow->uuid
                && ($transition['version_uuid'] ?? null) === $deployment->uuid && ($transition['organization_uuid'] ?? null) === $org->uuid
                && ($transition['device_uuid'] ?? null) === $deployment->definition['binding']['device_uuid']
                && $transition['definition_hash'] === $deployment->definition_hash, 422, 'Transition does not match execution snapshot.');
            DB::table('automation_transitions')->insertOrIgnore(['id' => $transition['id'], 'automation_deployment_id' => $deployment->id,
                'transition' => json_encode($transition, JSON_THROW_ON_ERROR), 'received_at' => now()]);
            GeofenceEventJournal::record($deployment, $transition, $transition['type']);

            return;
        }
        if ($type === 'workflow.transition.v1') {
            validator($payload, ['transition' => 'required|array', 'transition.id' => 'required|string|size:64', 'transition.type' => 'required|in:activated,cleared', 'transition.definition_hash' => 'required|string|size:64', 'transition.episode' => 'required|integer|min:1', 'transition.occurred_at' => 'required|date'])->validate();
            $transition = $payload['transition'];
            abort_unless($deployment->target === 'active' && ($transition['rule_uuid'] ?? null) === $workflow->uuid && ($transition['version_uuid'] ?? null) === $deployment->uuid && ($transition['organization_uuid'] ?? null) === $org->uuid && ($transition['device_uuid'] ?? null) === $deployment->definition['binding']['device_uuid'] && $transition['definition_hash'] === $deployment->definition_hash, 422, 'Transition does not match the execution snapshot.');
            DB::table('automation_transitions')->insertOrIgnore(['id' => $transition['id'], 'automation_deployment_id' => $deployment->id, 'transition' => json_encode($transition, JSON_THROW_ON_ERROR), 'received_at' => now()]);
            app(AlertProjector::class)->project($workflow, $deployment, $transition);
            GeofenceEventJournal::record($deployment, $transition, $transition['type'] === 'activated' ? 'wandering_started' : 'wandering_resolved');

            return;
        }
        if ($type === 'workflow.suspended.v1') {
            $deployment->update(['stopped_reason' => DagDiagnostic::stoppedReason((string) ($payload['reason'] ?? ''))]);
            if ($workflow->applied_deployment_uuid === $deployment->uuid && $workflow->pending_operation_uuid === null) {
                $workflow->update(['deployment_status' => 'suspended']);
            }

            return;
        }
        validator($payload, ['generation' => 'required|integer|min:1', 'target' => 'required|in:active,inactive', 'status' => 'required|in:succeeded,failed', 'diagnostic' => 'nullable|string|max:4000'])->validate();
        abort_unless($deployment->generation === $payload['generation'] && $deployment->target === $payload['target'], 422, 'Deployment outcome does not match its request.');
        if ($deployment->status !== 'pending') {
            return;
        }
        $deployment->update(['status' => $payload['status'], 'diagnostic' => $payload['diagnostic'] ?? null, 'completed_at' => now()]);
        if ($workflow->pending_operation_uuid !== $deployment->uuid || $workflow->deployment_generation !== $deployment->generation) {
            return;
        }
        if ($deployment->status === 'failed') {
            $workflow->update(['pending_operation_uuid' => null, 'deployment_status' => 'failed']);
        } else {
            if ($workflow->applied_deployment_uuid) {
                Deployment::where('uuid', $workflow->applied_deployment_uuid)->whereNull('stopped_reason')->update(['stopped_reason' => $deployment->target === 'active' ? 'superseded' : 'disabled']);
            }
            $workflow->update(['pending_operation_uuid' => null, 'applied_deployment_uuid' => $deployment->target === 'active' ? $deployment->uuid : null, 'deployment_status' => $deployment->target === 'inactive' ? 'inactive' : ($deployment->stopped_reason ? 'suspended' : 'applied')]);
        }
        DeviceAudit::record('workflow.deployment_'.$deployment->status, $org->id, null, $workflow->uuid, ['operation_uuid' => $deployment->uuid]);
    }
}
