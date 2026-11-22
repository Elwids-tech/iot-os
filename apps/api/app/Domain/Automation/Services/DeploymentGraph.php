<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use Illuminate\Support\Str;

/**
 * Reads one deployment's execution snapshot: a DAG automation's graph (bindings, nodes
 * and edges, `automation-workflow.v2`) or a geofence rule's single binding. The
 * snapshot is immutable, so what is read from it never goes stale (spec 037).
 */
final class DeploymentGraph
{
    /** @param  array<string, mixed>  $definition */
    private function __construct(private readonly array $definition) {}

    /** @param  array<string, mixed>|null  $definition */
    public static function of(?array $definition): self
    {
        return new self($definition ?? []);
    }

    /**
     * The devices whose readings the deployment reads, in binding order: the bindings
     * its parameter sources name, or a geofence rule's one device. A binding used only
     * to send a command is not read. A snapshot that names no source (older and
     * partial ones) reads its first binding, as alerts always assumed.
     *
     * @return list<string>
     */
    public function readDeviceUuids(): array
    {
        $single = $this->definition['binding']['device_uuid'] ?? null;
        if (is_string($single)) {
            return Str::isUuid($single) ? [$single] : [];
        }
        $bindings = array_values(array_filter((array) ($this->definition['bindings'] ?? []), 'is_array'));
        $roles = $this->sourceRoles();
        $read = $roles === [] ? array_slice($bindings, 0, 1) : array_filter($bindings, fn (array $binding): bool => isset($roles[$binding['role'] ?? '']));
        $uuids = [];
        foreach ($read as $binding) {
            $uuid = $binding['device_uuid'] ?? null;
            if (is_string($uuid) && Str::isUuid($uuid)) {
                $uuids[$uuid] = true;
            }
        }

        return array_keys($uuids);
    }

    /** Windows whose result is still on the reading's own value axis. */
    private const AGGREGATES = ['average', 'min', 'max'];

    /** What a comparison becomes when the alert is raised on its opposite outcome. */
    private const OPPOSITE = ['gt' => 'lte', 'gte' => 'lt', 'lt' => 'gte', 'lte' => 'gt'];

    /** The runtime's unit table (services/runtime/internal/dag/evaluator.go): family, scale and offset to the family's base. */
    private const UNITS = [
        'C' => ['temperature', 1.0, 273.15], 'F' => ['temperature', 5.0 / 9, 255.3722222222222], 'K' => ['temperature', 1.0, 0.0],
        'Pa' => ['pressure', 1.0, 0.0], 'kPa' => ['pressure', 1000.0, 0.0], 'bar' => ['pressure', 100000.0, 0.0],
        'm' => ['length', 1.0, 0.0], 'cm' => ['length', 0.01, 0.0],
    ];

    /**
     * The alert limits of the deployment: each value on one device parameter at which
     * an alert step is raised or cleared (spec 037, research R3). The walk goes from
     * every alert step upstream to its conditions, and from each condition to the one
     * reading it compares. It gives up on a branch it cannot place exactly on the
     * reading's own value axis, and on any step it does not know, so a limit is never
     * approximated. contracts/rules/v2/alert-limits.fixture.json holds the cases; the
     * runtime's evaluator is tested against the same file.
     *
     * @return list<array{device_uuid: string, parameter_uuid: string, role: 'raise'|'clear', operator: 'gt'|'gte'|'lt'|'lte'|'eq', value: int|float, unit: string, aggregate: 'average'|'min'|'max'|null, window_seconds: ?int, held_seconds: ?int, combined: bool}>
     */
    public function alertLimits(): array
    {
        $nodes = [];
        foreach ((array) ($this->definition['nodes'] ?? []) as $node) {
            if (is_array($node) && is_string($node['id'] ?? null) && is_string($node['type'] ?? null)) {
                $nodes[$node['id']] = $node;
            }
        }
        // What feeds each input port. A port fed twice is not a graph the runtime runs.
        $inputs = [];
        foreach ((array) ($this->definition['edges'] ?? []) as $edge) {
            if (! is_array($edge) || ! isset($edge['source'], $edge['target'])) {
                continue;
            }
            $key = $edge['target'].'|'.($edge['target_port'] ?? 'in');
            $inputs[$key] = isset($inputs[$key]) ? false : [(string) $edge['source'], (string) ($edge['source_port'] ?? 'out')];
        }
        $bindings = [];
        foreach ((array) ($this->definition['bindings'] ?? []) as $binding) {
            if (is_array($binding) && is_string($binding['role'] ?? null)) {
                $bindings[$binding['role']] = $binding;
            }
        }
        $limits = [];
        foreach ($nodes as $id => $node) {
            if ($node['type'] === 'action.alert.v1') {
                foreach ($this->conditions($nodes, $inputs, $bindings, $id, 'in', false, 0, false, 0) as $limit) {
                    $limits[json_encode($limit)] = $limit;
                }
            }
        }
        $limits = array_values($limits);
        usort($limits, fn (array $a, array $b): int => [$a['device_uuid'], $a['parameter_uuid'], $a['value'], $a['role']] <=> [$b['device_uuid'], $b['parameter_uuid'], $b['value'], $b['role']]);

        return $limits;
    }

    /**
     * The limits behind one boolean input, walking upstream.
     *
     * @return list<array<string, mixed>>
     */
    private function conditions(array $nodes, array $inputs, array $bindings, string $target, string $port, bool $inverted, int $held, bool $combined, int $depth): array
    {
        $from = $inputs[$target.'|'.$port] ?? null;
        $node = is_array($from) ? ($nodes[$from[0]] ?? null) : null;
        if ($node === null || $depth > 64) {
            return [];
        }
        $config = (array) ($node['config'] ?? []);
        $up = fn (string $port, bool $inverted, int $held, bool $combined): array => $this->conditions($nodes, $inputs, $bindings, $node['id'], $port, $inverted, $held, $combined, $depth + 1);

        switch ($node['type']) {
            case 'sustained.v1':
                return is_numeric($config['seconds'] ?? null) ? $up('in', $inverted, $held + (int) $config['seconds'], $combined) : [];
            case 'cooldown.v1':
                return $up('in', $inverted, $held, $combined);
            case 'boolean.v1':
                return [...$up('a', $inverted, $held, true), ...$up('b', $inverted, $held, true)];
            case 'branch.v1':
                return in_array($from[1], ['true', 'false'], true) ? $up('in', $from[1] === 'false' ? ! $inverted : $inverted, $held, $combined) : [];
            case 'compare.v1':
                $operator = $config['operator'] ?? null;
                $operator = $inverted ? (self::OPPOSITE[$operator] ?? null) : (in_array($operator, ['gt', 'gte', 'lt', 'lte', 'eq'], true) ? $operator : null);
                $marks = $operator === null ? [] : [['raise', $operator, $config['value'] ?? null]];
                break;
            case 'hysteresis.v1':
                // On the opposite outcome the alert depends on what happened before, not on one value.
                $marks = $inverted ? [] : [['raise', 'gt', $config['activate_above'] ?? null], ['clear', 'lt', $config['clear_below'] ?? null]];
                break;
            default:
                return [];
        }
        $reading = $marks === [] ? null : $this->reading($nodes, $inputs, $bindings, $node['id']);
        $limits = [];
        foreach ($reading === null ? [] : $marks as [$role, $operator, $value]) {
            $value = is_int($value) || is_float($value) ? $this->inParameterUnit($value, $reading['conversions'], (string) $reading['binding']['unit']) : null;
            if ($value === null) {
                return [];
            }
            $limits[] = [
                'device_uuid' => $reading['binding']['device_uuid'], 'parameter_uuid' => $reading['binding']['parameter_uuid'],
                'role' => $role, 'operator' => $operator, 'value' => $value, 'unit' => (string) $reading['binding']['unit'],
                'aggregate' => $reading['aggregate'], 'window_seconds' => $reading['window_seconds'],
                'held_seconds' => $held > 0 ? $held : null, 'combined' => $combined,
            ];
        }

        return $limits;
    }

    /**
     * The one reading a condition compares, with how it is treated on the way: at most
     * one window and any unit conversions, nearest the condition first. Null when the
     * value is not one numeric device parameter on its own axis.
     *
     * @return array{binding: array<string, mixed>, aggregate: ?string, window_seconds: ?int, conversions: list<array{string, string}>}|null
     */
    private function reading(array $nodes, array $inputs, array $bindings, string $target): ?array
    {
        [$port, $aggregate, $window, $conversions] = ['in', null, null, []];
        for ($depth = 0; $depth <= 64; $depth++) {
            $from = $inputs[$target.'|'.$port] ?? null;
            $node = is_array($from) ? ($nodes[$from[0]] ?? null) : null;
            $config = (array) ($node['config'] ?? []);
            switch ($node['type'] ?? null) {
                case 'source.parameter.v1':
                    $binding = $bindings[$config['binding'] ?? ''] ?? null;
                    $numeric = $binding !== null && ($binding['data_type'] ?? null) === 'number' && Str::isUuid($binding['device_uuid'] ?? null) && Str::isUuid($binding['parameter_uuid'] ?? null);

                    return $numeric ? ['binding' => $binding, 'aggregate' => $aggregate, 'window_seconds' => $window, 'conversions' => $conversions] : null;
                case 'join.v1':
                    // Each output passes on the input of the same name.
                    [$target, $port] = [$node['id'], $from[1]];
                    break;
                case 'window.v1':
                    if ($aggregate !== null || ! in_array($config['aggregate'] ?? null, self::AGGREGATES, true) || ! is_numeric($config['duration_seconds'] ?? null)) {
                        return null;
                    }
                    [$target, $port, $aggregate, $window] = [$node['id'], 'in', $config['aggregate'], (int) $config['duration_seconds']];
                    break;
                case 'convert.v1':
                    if (! is_string($config['from'] ?? null) || ! is_string($config['to'] ?? null)) {
                        return null;
                    }
                    [$target, $port] = [$node['id'], 'in'];
                    $conversions[] = [$config['from'], $config['to']];
                    break;
                default:
                    return null;
            }
        }

        return null;
    }

    /**
     * A limit stated after conversions, taken back to the parameter's own unit. The
     * runtime's units convert with a positive linear formula, so the side of the limit
     * is unchanged. Null when a conversion does not start where the one before it
     * ended, or from the parameter's unit, or crosses unit families.
     *
     * @param  list<array{string, string}>  $conversions  from and to, nearest the condition first
     */
    private function inParameterUnit(int|float $value, array $conversions, string $unit): int|float|null
    {
        if ($conversions === []) {
            return $value;
        }
        $expected = null;
        foreach ($conversions as [$from, $to]) {
            [$a, $b] = [self::UNITS[$from] ?? null, self::UNITS[$to] ?? null];
            if ($a === null || $b === null || $a[0] !== $b[0] || ($expected !== null && $to !== $expected)) {
                return null;
            }
            $value = ($value * $b[1] + $b[2] - $a[2]) / $a[1];
            $expected = $from;
        }
        if ($expected !== $unit || $value == 0) {
            return $expected === $unit ? 0 : null;
        }
        $rounded = round($value, 9 - (int) floor(log10(abs($value))));

        return $rounded == (int) $rounded && abs($rounded) < 1e15 ? (int) $rounded : $rounded;
    }

    /**
     * The binding roles named by parameter source nodes.
     *
     * @return array<string, true>
     */
    private function sourceRoles(): array
    {
        $roles = [];
        foreach ((array) ($this->definition['nodes'] ?? []) as $node) {
            $role = is_array($node) && ($node['type'] ?? null) === 'source.parameter.v1' ? ($node['config']['binding'] ?? null) : null;
            if (is_string($role) && $role !== '') {
                $roles[$role] = true;
            }
        }

        return $roles;
    }
}
