<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class DagDeployment
{
    public function request(Workflow $workflow, array $input, User $actor): Deployment
    {
        return DB::transaction(function () use ($workflow, $input, $actor) {
            $w = Workflow::whereKey($workflow->id)->lockForUpdate()->firstOrFail();
            $org = Organization::findOrFail($w->organization_id);
            $existing = Deployment::where('uuid', $input['operation_uuid'])->first();
            $grants = $input['command_grants'] ?? [];
            if ($existing) {
                abort_unless($existing->automation_workflow_id === $w->id && $existing->generation === $input['expected_generation'] + 1 && $existing->draft_revision === $input['draft_revision'] && $existing->target === $input['target_state'] && ($existing->command_grants ?? []) === $grants, 409, 'Operation identity belongs to another request.');

                return $existing;
            }
            abort_unless($w->draft_revision === $input['draft_revision'] && $w->deployment_generation === $input['expected_generation'] && ! $w->pending_operation_uuid, 409, 'Workflow changed or deployment pending.');
            $definition = null;
            $hash = null;
            if ($input['target_state'] === 'active') {
                app(DagAuthorization::class)->enabled($org);
                $settings = DB::table('automation_settings')->where('organization_id', $org->id)->lockForUpdate()->first();
                abort_if($settings->stopped, 409, 'Organization automation is stopped.');
                $compiled = app(DagAuthoring::class)->compile($org, $w->workflow, $w->uuid, $input['operation_uuid']);
                abort_unless($compiled['valid'] ?? false, 422, 'Workflow no longer compiles.');
                $definition = $compiled['definition'];
                $hash = $compiled['definition_hash'];
                foreach ($definition['bindings'] as $b) {
                    $device = Device::where('organization_id', $org->id)->where('uuid', $b['device_uuid'])->lockForUpdate()->firstOrFail();
                    abort_unless($device->lifecycle === 'active' && $device->applied_configuration_uuid === $b['configuration_uuid'] && $device->applied_generation === $b['generation'] && in_array($device->deployment_status, ['applied', 'failed'], true), 422, 'All bindings must use the currently applied device configuration.');
                }
                $commands = collect($definition['nodes'])->where('type', 'action.command.v1')->flatMap(fn ($node) => array_map(fn ($config) => [...$node, 'config' => $config], CommandSettings::configurations($node['config'])));
                abort_unless(count($grants) === $commands->count(), 422, 'Approve exactly one grant per selected setting.');
                // A grant without expires_at lasts until the deployment is replaced or its approver loses Device.command, which every dispatch re-checks.
                validator(['grants' => $grants], ['grants.*' => 'array:node_id,binding,value,cooldown_seconds,max_per_minute,expires_at', 'grants.*.node_id' => 'required|string', 'grants.*.binding' => 'required|string', 'grants.*.value' => 'present', 'grants.*.cooldown_seconds' => 'required|integer|min:1|max:86400', 'grants.*.max_per_minute' => 'required|integer|min:1|max:60', 'grants.*.expires_at' => 'nullable|date|after:now|before:'.now()->addYear()->toIso8601String()])->validate();
                foreach ($commands as $node) {
                    $c = $node['config'];
                    $matches = collect($grants)->where('node_id', $node['id'])->where('binding', $c['binding']);
                    abort_unless($matches->count() === 1, 422, 'Approve each selected setting exactly once.');
                    $g = $matches->first();
                    abort_unless($g && $g['binding'] === $c['binding'] && $g['value'] === $c['value'] && $g['cooldown_seconds'] >= $c['cooldown_seconds'], 422, 'Command grant does not match the reviewed node.');
                    $b = collect($definition['bindings'])->firstWhere('role', $g['binding']);
                    $device = Device::where('organization_id', $org->id)->where('uuid', $b['device_uuid'])->firstOrFail();
                    app(DeviceAuthorization::class)->authorize($actor, DevicePermission::COMMAND, $org, $device);
                }
            } else {
                abort_if(count($grants) > 0, 422, 'Disable does not accept command grants.');
            }
            $d = Deployment::create(['uuid' => $input['operation_uuid'], 'automation_workflow_id' => $w->id, 'generation' => $w->deployment_generation + 1, 'draft_revision' => $w->draft_revision, 'target' => $input['target_state'], 'definition' => $definition, 'definition_hash' => $hash, 'command_grants' => $grants, 'status' => 'pending', 'created_by' => $actor->id, 'created_at' => now()]);
            $w->update(['deployment_generation' => $d->generation, 'deployment_status' => 'pending', 'pending_operation_uuid' => $d->uuid, 'desired_deployment_uuid' => $d->target === 'active' ? $d->uuid : null]);
            DB::table('automation_actions')->whereIn('automation_deployment_id', Deployment::where('automation_workflow_id', $w->id)->select('id'))->where('status', 'accepted')->update(['status' => 'cancelled', 'diagnostic' => 'Deployment replaced or disabled.', 'updated_at' => now()]);
            DeviceAudit::enqueue('workflow.deploy.v2', ['operation_uuid' => $d->uuid, 'rule_uuid' => $w->uuid, 'organization_uuid' => $org->uuid, 'generation' => $d->generation, 'target' => $d->target, 'definition' => $definition]);
            DeviceAudit::record('workflow.deployment_requested', $org->id, $actor->id, $w->uuid, ['operation_uuid' => $d->uuid, 'command_grants' => $grants]);

            return $d;
        });
    }
}
