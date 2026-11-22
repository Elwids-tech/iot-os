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
