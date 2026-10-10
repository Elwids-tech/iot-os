<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/** Directory columns for one page of v2 workflows in a fixed number of queries, never per row. */
final class DagDirectory
{
    private const PROBLEM_ACTIONS = ['failed', 'uncertain', 'expired'];

    /** @param  Collection<int, Workflow>  $workflows */
    public function summarize(Organization $organization, Collection $workflows): array
    {
        $ids = $workflows->pluck('id')->all();
        if (! $ids) {
            return [];
        }
        $latest = DB::table('automation_deployments as d')
            ->joinSub(DB::table('automation_deployments')->whereIn('automation_workflow_id', $ids)->groupBy('automation_workflow_id')->selectRaw('automation_workflow_id, max(generation) as generation'), 'l', fn ($join) => $join->on('d.automation_workflow_id', '=', 'l.automation_workflow_id')->on('d.generation', '=', 'l.generation'))
            ->get(['d.automation_workflow_id', 'd.target', 'd.status', 'd.draft_revision', 'd.diagnostic', 'd.stopped_reason', 'd.created_at', 'd.completed_at'])
            ->keyBy('automation_workflow_id');
        $actions = fn () => DB::table('automation_actions as a')->join('automation_deployments as d', 'd.id', '=', 'a.automation_deployment_id')
            ->where('a.organization_id', $organization->id)->whereIn('d.automation_workflow_id', $ids);
        $lastActions = $actions()->groupBy('d.automation_workflow_id')->selectRaw('d.automation_workflow_id, max(a.created_at) as at')->pluck('at', 'automation_workflow_id');
        $problems = DB::query()->fromSub($actions()->whereIn('a.status', self::PROBLEM_ACTIONS)
            ->selectRaw('d.automation_workflow_id, a.status, a.diagnostic, a.updated_at, row_number() over (partition by d.automation_workflow_id order by a.updated_at desc, a.id desc) as position'), 'p')
            ->where('position', 1)->get()->keyBy('automation_workflow_id');

        $sources = $workflows->mapWithKeys(fn (Workflow $w) => [$w->id => $this->sources($w->workflow)]);
        $bindings = $sources->flatten(1);
        $devices = Device::where('organization_id', $organization->id)->whereIn('uuid', $bindings->pluck('device_uuid')->unique()->values())->pluck('name', 'uuid');
        $labels = [];
        foreach (DeviceConfiguration::whereIn('uuid', $bindings->pluck('configuration_uuid')->unique()->values())->whereHas('device', fn ($query) => $query->where('organization_id', $organization->id))->get(['uuid', 'definition']) as $configuration) {
            foreach (json_decode($configuration->definition['profile_canonical_json'] ?? '{}', true)['parameters'] ?? [] as $parameter) {
                $labels[$configuration->uuid][$parameter['uuid']] = $parameter['label'] ?? $parameter['name'] ?? $parameter['key'];
            }
        }

        return $workflows->mapWithKeys(function (Workflow $w) use ($latest, $lastActions, $problems, $sources, $devices, $labels) {
            $deployment = $latest->get($w->id);
            $issues = [];
            if ($deployment?->status === 'failed') {
                $issues[] = ['source' => 'deployment', 'message' => $deployment->diagnostic ?: 'Deployment failed.', 'at' => $this->iso($deployment->completed_at ?? $deployment->created_at)];
            } elseif ($deployment?->stopped_reason === 'binding_changed') {
                $issues[] = ['source' => 'deployment', 'message' => 'Suspended: a bound device configuration changed. Review the bindings and reactivate.', 'at' => $this->iso($deployment->completed_at ?? $deployment->created_at)];
            }
            if ($action = $problems->get($w->id)) {
                $issues[] = ['source' => 'action', 'message' => $action->diagnostic ?: 'Action '.str_replace('_', ' ', $action->status).'.', 'at' => $this->iso($action->updated_at)];
            }
            usort($issues, fn ($a, $b) => strcmp((string) $b['at'], (string) $a['at']));

            return [$w->id => [
                'deployment_diagnostic' => $deployment?->diagnostic,
                'updated_at' => $this->iso($w->updated_at),
                'triggers' => collect($sources->get($w->id))->map(fn ($b) => [
                    'node_id' => $b['node_id'], 'device_uuid' => $b['device_uuid'], 'device_name' => $devices->get($b['device_uuid']),
                    'parameter' => $labels[$b['configuration_uuid']][$b['parameter_uuid']] ?? str_replace('_', ' ', $b['role']),
                ])->values()->all(),
                'last_action_at' => $this->iso($lastActions->get($w->id)),
                'last_deployment' => $deployment ? ['target' => $deployment->target, 'status' => $deployment->status, 'at' => $this->iso($deployment->completed_at ?? $deployment->created_at), 'draft_revision' => (int) $deployment->draft_revision] : null,
                'last_issue' => $issues[0] ?? null,
            ]];
        })->all();
    }

    /** Device parameters read by source nodes: the readings that start an evaluation. */
    private function sources(array $graph): array
    {
        $bindings = collect($graph['bindings'] ?? [])->keyBy('role');

        return collect($graph['nodes'] ?? [])->where('type', 'source.parameter.v1')
            ->map(fn ($node) => ($binding = $bindings->get($node['config']['binding'] ?? '')) ? ['node_id' => $node['id'], ...$binding] : null)
            ->filter()->values()->all();
    }

    private function iso(mixed $value): ?string
    {
        return $value ? Carbon::parse($value)->toIso8601ZuluString() : null;
    }
}
