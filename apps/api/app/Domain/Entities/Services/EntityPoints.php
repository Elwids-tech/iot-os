<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Entities\Models\ParameterPlacement;
use Illuminate\Support\Collection;
use Throwable;

/**
 * The points at an entity: device parameters as they appear there, through a device's
 * placement or a parameter placement, each under a leaf name (spec 009, FR-010, FR-011,
 * FR-017, research R9). Computed on read, never stored, so profile upgrades need nothing
 * from the hierarchy.
 *
 * Names at one entity are unique ignoring case. A child entity's path name always keeps
 * its name; among points, the one that was there first keeps it and a later one (a
 * parameter a profile upgrade added) is reported `name_clash`. A parameter placement whose parameter the device's current profile
 * revision no longer has is `not_in_configuration`.
 */
final class EntityPoints
{
    /**
     * Every point at the entities, in no particular order.
     *
     * @param  list<int>  $entityIds
     * @param  array{0: int, 1: ?string}|null  $exclude  a device id and a parameter UUID to leave out when checking a change to them; with a null UUID, only the device's placement
     * @return list<array{entity_id: int, name: string, state: 'placed'|'name_clash'|'not_in_configuration', via: 'placement'|'parameter_placement', device: Device, parameter: array{uuid: string, key: string, label: string, unit: ?string}}>
     */
    public function at(array $entityIds, ?array $exclude = null): array
    {
        if ($entityIds === []) {
            return [];
        }
        $placements = EntityPlacement::query()->whereIn('entity_id', $entityIds)->whereNull('ended_at')
            ->with(['device.appliedConfiguration', 'device.lastAppliedConfiguration'])->get();
        $parameterPlacements = ParameterPlacement::query()->whereIn('entity_id', $entityIds)->whereNull('ended_at')
            ->with(['device.appliedConfiguration', 'device.lastAppliedConfiguration'])->get();
        // Parameters placed on their own anywhere leave their device's placement.
        $elsewhere = ParameterPlacement::query()->whereIn('device_id', $placements->pluck('device_id'))->whereNull('ended_at')
            ->get(['device_id', 'parameter_uuid'])->map(fn ($row) => $row->device_id.'|'.$row->parameter_uuid)->flip();

        $candidates = [];
        foreach ($placements as $placement) {
            // A placement's names date from when the placement started or, if later, from
            // the configuration that defines them: after a profile upgrade adds a clashing
            // parameter, the new one is reported, not the point that was there first.
            $configuration = $placement->device->appliedConfiguration ?? $placement->device->lastAppliedConfiguration;
            $since = max($placement->started_at?->getTimestamp() ?? 0, $configuration?->created_at?->getTimestamp() ?? 0);
            foreach (DeviceParameters::of($placement->device) as $uuid => $parameter) {
                if (isset($elsewhere[$placement->device_id.'|'.$uuid]) || $this->excluded($exclude, $placement->device_id, $uuid)) {
                    continue;
                }
                $candidates[] = ['entity_id' => $placement->entity_id, 'name' => $placement->leaf_names[$uuid] ?? $parameter['key'], 'via' => 'placement',
                    'device' => $placement->device, 'parameter' => $parameter, 'order' => [$since, $placement->id, 0]];
            }
        }
        foreach ($parameterPlacements as $placement) {
            // Only a change to this very parameter leaves its own placement out.
            if ($exclude !== null && $exclude[1] !== null && $this->excluded($exclude, $placement->device_id, $placement->parameter_uuid)) {
                continue;
            }
            $parameter = DeviceParameters::of($placement->device)[$placement->parameter_uuid] ?? null;
            $candidates[] = ['entity_id' => $placement->entity_id, 'name' => $placement->leaf_name, 'via' => 'parameter_placement', 'device' => $placement->device,
                'parameter' => $parameter ?? ['uuid' => $placement->parameter_uuid, 'key' => $placement->parameter_key, 'label' => $placement->parameter_key, 'unit' => null],
                'missing' => $parameter === null, 'order' => [$placement->started_at?->getTimestamp() ?? 0, $placement->id, 1]];
        }
        usort($candidates, fn (array $a, array $b): int => $a['order'] <=> $b['order']);

        $taken = $this->childNames($entityIds);
        $points = [];
        foreach ($candidates as $candidate) {
            $key = $candidate['entity_id'].'|'.strtolower($candidate['name']);
            $state = match (true) {
                $candidate['missing'] ?? false => 'not_in_configuration',
                isset($taken[$key]) => 'name_clash',
                default => 'placed',
            };
            if ($state === 'placed') {
                $taken[$key] = true;
            }
            unset($candidate['order'], $candidate['missing']);
            $points[] = [...$candidate, 'state' => $state];
        }

        return $points;
    }

    /**
     * The names in use at an entity, lower-cased: active children's path names and placed points.
     *
     * @param  array{0: int, 1: ?string}|null  $exclude
     * @return array<string, true>
     */
    public function namesAt(Entity $entity, ?array $exclude = null): array
    {
        $names = [];
        foreach ($this->childNames([$entity->id]) as $key => $_) {
            $names[substr($key, strlen($entity->id.'|'))] = true;
        }
        foreach ($this->at([$entity->id], $exclude) as $point) {
            if ($point['state'] === 'placed') {
                $names[strtolower($point['name'])] = true;
            }
        }

        return $names;
    }

    /**
     * One page of the points at an entity, or in its branch, by path, with latest values.
     *
     * @return array{data: list<array<string, mixed>>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    public function page(Entity $entity, bool $branch, int $page, int $perPage = 50): array
    {
        // A branch request covers the entity's coverage: its branch and its members' (FR-017).
        $ids = $branch ? Coverage::entityIds($entity)->pluck('descendant_id')->map(fn ($id) => (int) $id)->all() : [$entity->id];
        $paths = Entity::query()->whereIn('id', $ids)->pluck('path', 'id');
        $points = collect($this->at($ids))->map(fn (array $point) => [...$point, 'path' => $paths[$point['entity_id']].'/'.$point['name']])
            ->sortBy(fn (array $point) => strtolower($point['path']).'|'.$point['device']->id)->values();
        $total = $points->count();
        $slice = $points->slice(($page - 1) * $perPage, $perPage)->values();
        $latest = $this->latest($entity, $slice);

        return [
            'data' => $slice->map(fn (array $point): array => [
                'leaf_name' => $point['name'],
                'path' => $point['path'],
                // Points of a member's branch keep their main-tree path; only the entity's own branch is shown relative.
                'relative_path' => str_starts_with(strtolower($point['path']), strtolower($entity->path).'/') ? substr($point['path'], strlen($entity->path) + 1) : $point['path'],
                'device' => ['uuid' => $point['device']->uuid, 'name' => $point['device']->name],
                'parameter' => ['uuid' => $point['parameter']['uuid'], 'key' => $point['parameter']['key'], 'label' => $point['parameter']['label'], 'unit' => $point['parameter']['unit']],
                'via' => $point['via'],
                'state' => $point['state'],
                'latest' => $latest[$point['device']->uuid.'|'.$point['parameter']['uuid']] ?? null,
            ])->all(),
            'meta' => ['current_page' => $page, 'last_page' => max(1, (int) ceil($total / $perPage)), 'per_page' => $perPage, 'total' => $total],
        ];
    }

    /**
     * Latest readings for the page's devices in one runtime request (research R17). A
     * value the runtime does not have is unknown (null), never zero; when the runtime
     * cannot answer, every value is unknown.
     *
     * @param  Collection<int, array<string, mixed>>  $points
     * @return array<string, array{value: mixed, quality: ?string, observed_at: ?string, received_at: ?string}>
     */
    private function latest(Entity $entity, Collection $points): array
    {
        $uuids = $points->map(fn (array $point) => $point['device']->uuid)->unique()->values()->all();
        if ($uuids === []) {
            return [];
        }
        try {
            $result = app(RuntimeClient::class)->request('GET', '/internal/measurements/latest-batch', [
                'organization_uuid' => $entity->organization->uuid, 'devices' => implode(',', $uuids),
            ]);
        } catch (Throwable) {
            return [];
        }
        $latest = [];
        foreach ($result['data'] ?? [] as $device => $entry) {
            foreach ($entry['data'] ?? [] as $reading) {
                // Scalars only here; a structured value (a location fix) is read on the device page.
                if (! isset($reading['parameter_uuid']) || ! array_key_exists('value', $reading) || ! is_scalar($reading['value'])) {
                    continue;
                }
                $latest[$device.'|'.$reading['parameter_uuid']] = ['value' => $reading['value'], 'quality' => $reading['quality'] ?? null,
                    'observed_at' => $reading['observed_at'] ?? null, 'received_at' => $reading['received_at'] ?? null];
            }
        }

        return $latest;
    }

    /**
     * @param  list<int>  $entityIds
     * @return array<string, true> "entity id|lower-cased path name"
     */
    private function childNames(array $entityIds): array
    {
        return Entity::query()->whereIn('parent_id', $entityIds)->whereNull('archived_at')->get(['parent_id', 'path_name'])
            ->mapWithKeys(fn (Entity $child) => [$child->parent_id.'|'.strtolower($child->path_name) => true])->all();
    }

    /** @param  array{0: int, 1: ?string}|null  $exclude */
    private function excluded(?array $exclude, int $deviceId, string $parameterUuid): bool
    {
        return $exclude !== null && $exclude[0] === $deviceId && ($exclude[1] === null || $exclude[1] === $parameterUuid);
    }
}
