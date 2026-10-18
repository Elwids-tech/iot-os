<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Services;

use App\Domain\Devices\Models\Device;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * What the automation assistant sees of an editor draft, and how its proposals map back to the draft.
 */
final class WorkflowDraftContext
{
    /**
     * The draft as the model sees it. A geofence boundary can hold 257 points, and the draft is resent on
     * every provider step, so each geometry becomes a reference to its node with a short summary.
     */
    public function prompt(array $target): array
    {
        foreach ((array) ($target['workflow']['nodes'] ?? []) as $index => $node) {
            $geometry = is_array($node) ? ($node['config']['geometry'] ?? null) : null;
            if (is_array($geometry) && is_string($node['id'] ?? null)) {
                $target['workflow']['nodes'][$index]['config']['geometry'] = ['draft_geometry' => $node['id'], ...$this->summary($geometry)];
            }
        }

        return $target;
    }

    /** A proposed workflow with each draft_geometry reference replaced by that draft node's geometry. */
    public function restore(array $workflow, array $target): array
    {
        $draft = collect((array) ($target['workflow']['nodes'] ?? []))->filter(fn ($node) => is_array($node) && is_string($node['id'] ?? null))->keyBy('id');
        $errors = [];
        foreach ((array) ($workflow['nodes'] ?? []) as $index => $node) {
            $geometry = is_array($node) ? ($node['config']['geometry'] ?? null) : null;
            if (! is_array($geometry) || ! array_key_exists('draft_geometry', $geometry)) {
                continue;
            }
            $source = is_string($geometry['draft_geometry']) ? ($draft->get($geometry['draft_geometry'])['config']['geometry'] ?? null) : null;
            if ($source === null) {
                $errors[] = 'Node '.($node['id'] ?? $index).': draft_geometry must name a node of the current draft that has geometry. Copy a saved geofence geometry from find_geofences instead.';

                continue;
            }
            $workflow['nodes'][$index]['config']['geometry'] = $source;
        }
        if ($errors !== []) {
            throw ValidationException::withMessages(['geometry' => $errors]);
        }

        return $workflow;
    }

    /**
     * Why each binding cannot be proposed, by role. The editor keeps a binding to any earlier configuration
     * of its device, but a proposal must use the device's current applied configuration and generation.
     */
    public function outdatedBindings(int $organizationId, array $bindings): array
    {
        $uuids = collect($bindings)->map(fn ($binding) => is_array($binding) ? ($binding['device_uuid'] ?? null) : null)
            ->filter(fn ($uuid) => is_string($uuid) && Str::isUuid($uuid))->map(fn (string $uuid) => strtolower($uuid));
        $devices = Device::where('organization_id', $organizationId)->whereIn('uuid', $uuids->all())->get()->keyBy(fn (Device $device) => strtolower($device->uuid));
        $outdated = [];
        foreach ($bindings as $index => $binding) {
            $binding = is_array($binding) ? $binding : [];
            $role = is_string($binding['role'] ?? null) ? $binding['role'] : 'at position '.((int) $index + 1);
            $uuid = is_string($binding['device_uuid'] ?? null) ? $binding['device_uuid'] : '';
            $device = $devices->get(strtolower($uuid));
            if (! $device?->applied_configuration_uuid) {
                $outdated[$role] = "Binding {$role}: device {$uuid} no longer exists in this organization or has no applied configuration. Ask the user which device should replace it, then use find_devices.";
            } elseif ($device->applied_configuration_uuid !== ($binding['configuration_uuid'] ?? null) || $device->deployment_generation !== ($binding['generation'] ?? null)) {
                $outdated[$role] = "Binding {$role}: device {$uuid} was reconfigured and now has configuration {$device->applied_configuration_uuid}, generation {$device->deployment_generation}. Call find_devices with device_uuid {$uuid} and copy the current configuration_uuid, generation and the parameter's uuid, data_type and unit.";
            }
        }

        return $outdated;
    }

    private function summary(array $geometry): array
    {
        $points = collect($geometry['coordinates'][0] ?? [])->filter(fn ($point) => is_array($point) && is_numeric($point[0] ?? null) && is_numeric($point[1] ?? null));
        if ($points->isEmpty()) {
            return [];
        }
        $longitudes = $points->map(fn (array $point) => (float) $point[0]);
        $latitudes = $points->map(fn (array $point) => (float) $point[1]);

        // [west, south, east, north], enough to say where a boundary is without its coordinates.
        return ['points' => $points->count(), 'bounds' => array_map(fn (float $value) => round($value, 6), [$longitudes->min(), $latitudes->min(), $longitudes->max(), $latitudes->max()])];
    }
}
