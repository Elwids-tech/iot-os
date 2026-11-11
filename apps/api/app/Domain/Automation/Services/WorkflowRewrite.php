<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

/**
 * Rewrites an automation onto other devices (spec 031, research R11): a pure function of
 * its graph and the maps from old devices and parameters to new ones. Each binding takes
 * its device's new UUID, configuration and generation, and its parameter's new UUID.
 * Nodes name bindings by role, so they stay as they are. It reports the bindings it
 * could not map and whether a node sends device commands.
 */
final class WorkflowRewrite
{
    /** The node type that sends device commands. */
    public const COMMAND = 'action.command.v1';

    /**
     * @param  array<string, mixed>  $graph  an `automation-workflow.v2` graph
     * @param  array<string, mixed>  $identity  top-level fields to replace: `uuid`, `version_uuid`, `organization_uuid`
     * @param  array<string, array{device_uuid: string, configuration_uuid: string, generation: int}>  $devices  old device UUID => its binding on the new one
     * @param  array<string, string>  $parameters  old parameter UUID => new
     * @return array{workflow: array<string, mixed>, unmapped: list<string>, commands: bool}
     */
    public static function rewrite(array $graph, array $identity, array $devices, array $parameters): array
    {
        $unmapped = [];
        $bindings = [];
        foreach ($graph['bindings'] ?? [] as $binding) {
            $device = $devices[$binding['device_uuid'] ?? ''] ?? null;
            $parameter = $parameters[$binding['parameter_uuid'] ?? ''] ?? null;
            if ($device === null || $parameter === null) {
                $unmapped[] = (string) ($binding['role'] ?? '');
            }
            // A mapped device moves even when its parameter does not: the binding is then
            // stale on the new device, never left on the old one.
            $bindings[] = $device === null ? $binding : [...$binding, ...$device, 'parameter_uuid' => $parameter ?? $binding['parameter_uuid']];
        }

        return [
            'workflow' => [...$graph, ...$identity, 'bindings' => $bindings],
            'unmapped' => $unmapped,
            'commands' => self::commands($graph),
        ];
    }

    /**
     * The device UUIDs an automation's bindings name, each once.
     *
     * @param  array<string, mixed>  $graph
     * @return list<string>
     */
    public static function devices(array $graph): array
    {
        return array_values(array_unique(array_filter(array_column($graph['bindings'] ?? [], 'device_uuid'), 'is_string')));
    }

    /** @param  array<string, mixed>  $graph */
    public static function commands(array $graph): bool
    {
        foreach ($graph['nodes'] ?? [] as $node) {
            if (($node['type'] ?? null) === self::COMMAND) {
                return true;
            }
        }

        return false;
    }
}
