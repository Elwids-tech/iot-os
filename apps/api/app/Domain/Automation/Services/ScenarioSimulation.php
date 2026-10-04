<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Workflow;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ScenarioSimulation
{
    public function steps(array $definition, Workflow $workflow): array
    {
        validator($definition, [
            'steps' => 'required|array|min:1|max:100',
            'steps.*' => 'array:label,at_seconds,device_uuid,readings,expected_actions,expected_outputs',
            'steps.*.label' => 'required|string|max:120',
            'steps.*.at_seconds' => 'required|integer|min:0|max:604800',
            'steps.*.device_uuid' => 'nullable|uuid',
            'steps.*.readings' => 'present|array|max:100',
            'steps.*.readings.*' => 'array:binding,value,quality,age_seconds',
            'steps.*.readings.*.binding' => 'required|string|max:120',
            'steps.*.readings.*.value' => 'present',
            'steps.*.readings.*.quality' => 'required|in:good,bad',
            'steps.*.readings.*.age_seconds' => 'required|integer|min:0|max:604800',
            'steps.*.expected_actions' => 'present|array|max:100',
            'steps.*.expected_actions.*' => 'integer|min:0|max:100',
            'steps.*.expected_outputs' => 'present|array|max:100',
            'steps.*.expected_outputs.*' => 'array:node_id,port,known,value',
            'steps.*.expected_outputs.*.node_id' => 'required|string|max:120',
            'steps.*.expected_outputs.*.port' => 'required|string|max:120',
            'steps.*.expected_outputs.*.known' => 'required|boolean',
            'steps.*.expected_outputs.*.value' => 'present',
        ])->validate();
        $graph = $workflow->workflow;
        $nodes = collect($graph['nodes'])->keyBy('id');
        $roles = collect($graph['nodes'])->where('type', 'source.parameter.v1')->pluck('config.binding')->all();
        $bindings = collect($graph['bindings'])->whereIn('role', $roles)->keyBy('role');
        $iso = fn (int $offset) => gmdate('Y-m-d\TH:i:s\Z', 1893456000 + $offset);
        $previous = -1;
        $result = [];
        foreach ($definition['steps'] as $i => $step) {
            $fail = fn (string $message) => throw ValidationException::withMessages(["definition.steps.$i" => $message]);
            if (($i === 0 && $step['at_seconds'] !== 0) || $step['at_seconds'] <= $previous) {
                $fail('Start at 0 seconds and use strictly increasing step times.');
            }
            $previous = $step['at_seconds'];
            foreach ($step['expected_actions'] as $id => $count) {
                if (! str_starts_with($nodes->get($id)['type'] ?? '', 'action.')) {
                    $fail("Action node $id no longer exists.");
                }
            }
            foreach ($step['expected_outputs'] as $check) {
                if (! $nodes->has($check['node_id'])) {
                    $fail('An expected node no longer exists.');
                }
                if ($check['known'] && ! is_scalar($check['value'])) {
                    $fail('Known output expectations require a scalar value.');
                }
            }
            $device = $step['device_uuid'] ?? null;
            $deviceBindings = $bindings->where('device_uuid', $device);
            if ($device && $deviceBindings->isEmpty()) {
                $fail('Select a source device bound to this workflow.');
            }
            if (! $device && $step['readings']) {
                $fail('Clock steps cannot include readings.');
            }
            $readings = [];
            $seen = [];
            foreach ($step['readings'] as $reading) {
                $b = $deviceBindings->get($reading['binding']);
                if (! $b || isset($seen[$b['parameter_uuid']])) {
                    $fail('Readings must use distinct source parameters from the selected device.');
                }
                $seen[$b['parameter_uuid']] = true;
                $value = $reading['value'];
                $valid = match ($b['data_type']) {
                    'number', 'integer' => is_int($value) || is_float($value),
                    'boolean' => is_bool($value),
                    default => is_string($value),
                };
                if ($value !== null && ! $valid) {
                    $fail("Invalid value type for {$b['role']}.");
                }
                if (is_string($value) && strlen($value) > 1024) {
                    $fail('Reading values are too long.');
                }
                $readings[] = ['parameter_uuid' => $b['parameter_uuid'], 'data_type' => $b['data_type'], 'unit' => $b['unit'] ?: null,
                    'value' => $value, 'quality' => $reading['quality'], 'observed_at' => $iso($previous - $reading['age_seconds'])];
            }
            $b = $deviceBindings->first();
            $result[] = ['at' => $iso($previous), 'event' => $device ? [
                'schema_version' => 'telemetry.committed.v1', 'event_id' => (string) Str::uuid(), 'organization_uuid' => $graph['organization_uuid'],
                'device_uuid' => $device, 'configuration_uuid' => $b['configuration_uuid'], 'generation' => $b['generation'],
                'readings' => $readings,
            ] : null];
        }

        return $result;
    }

    public function evaluate(array $definition, array $graph, array $simulation): array
    {
        $actions = collect($graph['nodes'])->filter(fn ($n) => str_starts_with($n['type'], 'action.'))->pluck('id')->all();
        $checks = [];
        foreach ($definition['steps'] as $i => $step) {
            $result = $simulation['steps'][$i] ?? null;
            $complete = $result !== null && ! ($result['trace_truncated'] ?? true);
            $checks[] = ['step' => $i, 'node_id' => null, 'label' => 'Complete simulation evidence', 'expected' => true, 'actual' => $complete, 'passed' => $complete];
            $counts = array_count_values(array_column($result['intents'] ?? [], 'node_id'));
            foreach (array_unique([...$actions, ...array_keys($counts)]) as $id) {
                $expected = $step['expected_actions'][$id] ?? 0;
                $actual = $counts[$id] ?? 0;
                $checks[] = ['step' => $i, 'node_id' => $id, 'label' => 'Action requests', 'expected' => $expected, 'actual' => $actual, 'passed' => $complete && $actual === $expected];
            }
            $trace = collect($result['trace'] ?? [])->keyBy('node_id');
            foreach ($step['expected_outputs'] as $check) {
                $actual = $trace->get($check['node_id'])['outputs'][$check['port']] ?? null;
                $known = (bool) $check['known'];
                $same = $actual !== null && ($actual['known'] ?? null) === $known;
                if ($same && $known) {
                    $a = $actual['value'] ?? null;
                    $e = $check['value'];
                    $same = $a === $e || ((is_int($a) || is_float($a)) && (is_int($e) || is_float($e)) && (float) $a === (float) $e);
                }
                $checks[] = ['step' => $i, 'node_id' => $check['node_id'], 'label' => 'Output '.$check['port'], 'expected' => ['known' => $known, 'value' => $known ? $check['value'] : null], 'actual' => $actual, 'passed' => $complete && $same];
            }
        }

        return ['passed' => count($simulation['steps'] ?? []) === count($definition['steps']) && ! collect($checks)->contains('passed', false), 'checks' => $checks, 'steps' => array_map(fn ($s) => ['trace' => $s['trace'] ?? [], 'intents' => $s['intents'] ?? [], 'trace_truncated' => $s['trace_truncated'] ?? true], $simulation['steps'] ?? []), 'mode' => 'side-effect-free'];
    }
}
