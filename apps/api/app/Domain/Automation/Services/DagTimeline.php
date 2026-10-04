<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceCommand;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

final class DagTimeline
{
    public function read(Organization $organization, Workflow $workflow, ?string $before, ?string $evaluation): array
    {
        $result = app(RuntimeClient::class)->request('GET', '/internal/dag/timeline', array_filter([
            'organization_uuid' => $organization->uuid, 'workflow_uuid' => $workflow->uuid,
            'before' => $before, 'evaluation_id' => $evaluation,
        ], fn ($value) => $value !== null));
        $items = $evaluation ? [$result['data']] : $result['data'];
        $deployments = Deployment::where('automation_workflow_id', $workflow->id)->whereIn('uuid', array_column($items, 'operation_uuid'))->get()->keyBy('uuid');
        $devices = Device::where('organization_id', $organization->id)->whereIn('uuid', collect($items)->pluck('source.device_uuid')->filter())->pluck('name', 'uuid');
        foreach ($items as &$item) {
            $deployment = $deployments->get($item['operation_uuid']);
            // Do not expose data without a matching immutable deployment in this workflow.
            abort_unless($deployment, 404, 'Deployment history is unavailable.');
            $item['generation'] = $deployment->generation;
            $item['draft_revision'] = $deployment->draft_revision;
            if (is_array($item['source'] ?? null)) {
                $item['source']['device_name'] = $devices->get($item['source']['device_uuid']);
            }
            if ($evaluation) {
                $definition = $deployment->definition;
                $nodes = collect($definition['nodes'])->keyBy('id');
                $bindings = collect($definition['bindings'])->keyBy('role');
                $targets = Device::where('organization_id', $organization->id)->whereIn('uuid', $bindings->pluck('device_uuid'))->pluck('name', 'uuid');
                $labels = [];
                foreach (DeviceConfiguration::whereIn('uuid', $bindings->pluck('configuration_uuid'))->whereHas('device', fn ($query) => $query->where('organization_id', $organization->id))->get() as $configuration) {
                    $profile = json_decode($configuration->definition['profile_canonical_json'] ?? '{}', true);
                    foreach ($profile['parameters'] ?? [] as $parameter) {
                        $labels[$parameter['uuid']] = $parameter['label'] ?? $parameter['key'];
                    }
                }
                foreach ($item['trace'] as &$step) {
                    $node = $nodes->get($step['node_id']);
                    $step['node_type'] = $node['type'] ?? 'unknown';
                    $step['config'] = $node['config'] ?? [];
                    $binding = $bindings->get($node['config']['binding'] ?? '');
                    if ($binding) {
                        $step['binding'] = [...$binding, 'device_name' => $targets->get($binding['device_uuid']), 'parameter_label' => $labels[$binding['parameter_uuid']] ?? $binding['role']];
                    }
                } unset($step);
                $actions = DB::table('automation_actions')->where('organization_id', $organization->id)->where('automation_deployment_id', $deployment->id)->whereIn('id', $item['intent_ids'])->get()->keyBy('id');
                $commands = DeviceCommand::whereIn('uuid', $actions->pluck('command_uuid')->filter())->whereHas('device', fn ($query) => $query->where('organization_id', $organization->id))->get()->keyBy('uuid');
                $item['actions'] = [];
                foreach ($item['intent_ids'] as $id) {
                    $action = $actions->get($id);
                    if (! $action) {
                        $item['actions'][] = ['id' => $id, 'status' => 'awaiting_dispatch', 'diagnostic' => 'The runtime requested this action; the action worker has not recorded it yet.'];

                        continue;
                    }
                    $intent = json_decode($action->intent, true, 512, JSON_THROW_ON_ERROR);
                    $binding = $bindings->get($intent['config']['binding'] ?? '');
                    $command = $commands->get($action->command_uuid);
                    $item['actions'][] = [
                        'id' => $id, 'node_id' => $action->node_id, 'kind' => $action->kind, 'status' => $action->status,
                        'diagnostic' => $action->diagnostic, 'requested_at' => $intent['occurred_at'] ?? null,
                        'accepted_at' => $this->time($action->created_at), 'updated_at' => $this->time($action->updated_at), 'expires_at' => $this->time($action->expires_at),
                        'dispatch_authorized_at' => $this->time($action->dispatch_authorized_at),
                        'binding' => $intent['config']['binding'] ?? null, 'value' => $intent['config']['value'] ?? null,
                        'device_uuid' => $binding['device_uuid'] ?? null, 'device_name' => $binding ? $targets->get($binding['device_uuid']) : null,
                        'parameter_label' => $binding ? ($labels[$binding['parameter_uuid']] ?? $binding['role']) : null,
                        'command' => $command?->only(['uuid', 'status', 'sent_at', 'confirmed_at', 'completed_at', 'diagnostic']),
                    ];
                }
            }
        } unset($item);
        $result['data'] = $evaluation ? $items[0] : $items;

        return $result;
    }

    private function time(?string $value): ?string
    {
        return $value ? Carbon::parse($value)->toIso8601String() : null;
    }
}
