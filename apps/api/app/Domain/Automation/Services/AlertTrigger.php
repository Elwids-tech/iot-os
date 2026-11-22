<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What an automation alert watches, read from the frozen definition of the execution
 * that raised it: the readings that feed its alert step and, when one comparison of
 * one reading decides it, the limit. The alert row stores no value, so this says what
 * was compared, never what the reading was.
 */
final class AlertTrigger
{
    /** At most this many readings are named. */
    public const LISTED_READINGS = 5;

    /** Steps that pass a reading on without changing its scale, so a limit after them still reads against it. */
    private const PLAIN = ['source.parameter.v1', 'compare.v1', 'hysteresis.v1', 'sustained.v1', 'cooldown.v1', 'window.v1'];

    /**
     * @return array{readings: list<array{device_uuid: string, parameter_uuid: string, name: ?string, unit: ?string}>, condition: ?array<string, mixed>, sustained_seconds: ?int, window: ?array{aggregate: ?string, duration_seconds: ?int}}|null
     */
    public function for(Organization $organization, Alert $alert): ?array
    {
        $definition = $alert->isWorkflow() ? $alert->deployment?->definition : null;
        $nodes = collect($definition['nodes'] ?? [])->filter(fn ($node) => is_array($node) && isset($node['id'], $node['type']))->keyBy('id');
        $step = $this->alertStep($alert, $nodes->all());
        if ($step === null) {
            return null;
        }
        $upstream = $this->upstream($step, $definition['edges'] ?? [])->map(fn (string $id) => $nodes->get($id))->filter()->values();
        $bindings = collect($definition['bindings'] ?? [])->filter(fn ($binding) => is_array($binding) && isset($binding['role']))->keyBy('role');
        $sources = $upstream->where('type', 'source.parameter.v1')
            ->map(fn (array $node) => $bindings->get($node['config']['binding'] ?? null))
            ->filter(fn ($binding) => isset($binding['device_uuid'], $binding['parameter_uuid']))
            ->unique(fn (array $binding) => $binding['device_uuid'].'|'.$binding['parameter_uuid'])->values();
        if ($sources->isEmpty()) {
            return null;
        }
        $names = $this->names($organization, $sources->all());
        $limits = $upstream->whereIn('type', ['compare.v1', 'hysteresis.v1'])->values();
        // A limit is stated only when it is the whole story: one reading, one comparison, nothing rescaling in between.
        $simple = $sources->count() === 1 && $limits->count() === 1 && $upstream->every(fn (array $node) => in_array($node['type'], self::PLAIN, true));
        $window = $upstream->firstWhere('type', 'window.v1');
        $sustained = $upstream->firstWhere('type', 'sustained.v1');

        return [
            'readings' => $sources->take(self::LISTED_READINGS)->map(fn (array $binding) => [
                'device_uuid' => (string) $binding['device_uuid'],
                'parameter_uuid' => (string) $binding['parameter_uuid'],
                'name' => $names[$binding['device_uuid'].'|'.$binding['parameter_uuid']] ?? null,
                'unit' => isset($binding['unit']) && $binding['unit'] !== '' ? (string) $binding['unit'] : null,
            ])->all(),
            'condition' => $simple ? $this->condition($limits[0]) : null,
            'sustained_seconds' => $simple && isset($sustained['config']['seconds']) ? (int) $sustained['config']['seconds'] : null,
            'window' => $simple && $window ? ['aggregate' => $window['config']['aggregate'] ?? null, 'duration_seconds' => isset($window['config']['duration_seconds']) ? (int) $window['config']['duration_seconds'] : null] : null,
        ];
    }

    /** The alert step that raised this episode: the one its activation names, else the definition's only one. */
    private function alertStep(Alert $alert, array $nodes): ?string
    {
        $steps = array_keys(array_filter($nodes, fn (array $node) => $node['type'] === 'action.alert.v1'));
        $named = $alert->activation_transition_id ? DB::table('automation_actions')->where('id', $alert->activation_transition_id)->where('automation_deployment_id', $alert->automation_deployment_id)->value('node_id') : null;
        if ($named !== null && in_array($named, $steps, true)) {
            return (string) $named;
        }

        return count($steps) === 1 ? (string) $steps[0] : null;
    }

    /** Every step that feeds `step`, nearest first. */
    private function upstream(string $step, array $edges): Collection
    {
        $seen = [$step => true];
        $queue = [$step];
        $found = [];
        while ($queue) {
            $target = array_shift($queue);
            foreach ($edges as $edge) {
                $source = $edge['source'] ?? null;
                if (($edge['target'] ?? null) !== $target || ! is_string($source) || isset($seen[$source])) {
                    continue;
                }
                $seen[$source] = true;
                $found[] = $source;
                $queue[] = $source;
            }
        }

        return collect($found);
    }

    private function condition(array $node): ?array
    {
        $config = $node['config'] ?? [];
        if ($node['type'] === 'compare.v1') {
            return isset($config['operator'], $config['value']) && is_numeric($config['value'])
                ? ['kind' => 'compare', 'operator' => (string) $config['operator'], 'value' => $config['value'] + 0]
                : null;
        }

        return isset($config['activate_above'], $config['clear_below']) && is_numeric($config['activate_above']) && is_numeric($config['clear_below'])
            ? ['kind' => 'hysteresis', 'activate_above' => $config['activate_above'] + 0, 'clear_below' => $config['clear_below'] + 0]
            : null;
    }

    /**
     * Reading names from the configuration each binding was made against, for devices
     * of this organization only.
     *
     * @return array<string, string> "device|parameter" => label
     */
    private function names(Organization $organization, array $bindings): array
    {
        $devices = Device::where('organization_id', $organization->id)->whereIn('uuid', array_column($bindings, 'device_uuid'))->get(['id', 'uuid', 'applied_configuration_uuid'])->keyBy('uuid');
        $names = [];
        foreach ($bindings as $binding) {
            $device = $devices->get($binding['device_uuid']);
            if (! $device) {
                continue;
            }
            $configuration = DeviceConfiguration::where('device_id', $device->id)
                ->whereIn('uuid', array_filter([$binding['configuration_uuid'] ?? null, $device->applied_configuration_uuid]))
                ->orderByRaw('case when uuid = ? then 0 else 1 end', [$binding['configuration_uuid'] ?? ''])->first();
            $profile = json_decode($configuration?->definition['profile_canonical_json'] ?? '[]', true) ?: [];
            $parameter = collect($profile['parameters'] ?? [])->firstWhere('uuid', $binding['parameter_uuid']);
            $name = $parameter['label'] ?? $parameter['name'] ?? $parameter['key'] ?? null;
            if (is_string($name) && $name !== '') {
                $names[$binding['device_uuid'].'|'.$binding['parameter_uuid']] = $name;
            }
        }

        return $names;
    }
}
