<?php

declare(strict_types=1);

namespace App\Domain\Dashboards\Services;

/**
 * Rewrites a dashboard's panels onto other devices (spec 031, research R11): a pure
 * function of the panels, their layouts and maps from the old UUIDs to the new ones.
 * Device references are panel sources (`config.sources[]`, `device_uuid` and
 * `parameter_uuid`), device health devices (`config.devices[]`) and GPS map devices
 * (`config.location_device_uuids[]`); a GPS map's geofence and an alert panel's
 * workflow are kept only when mapped. Anything unmapped is dropped, a panel left
 * with nothing to show is omitted, and both are reported. `device_name` snapshots
 * are kept; the next save refreshes them.
 */
final class DashboardRewrite
{
    /**
     * @param  list<array<string, mixed>>  $widgets
     * @param  array<string, list<array<string, mixed>>>  $layouts
     * @param  array<string, string>  $devices  old device UUID => new
     * @param  array<string, string>  $parameters  old parameter UUID => new
     * @param  array<string, string>  $references  old workflow or geofence UUID => new
     * @param  bool  $keepOnly  omit panels that name no mapped device or reference (a copy)
     * @return array{widgets: list<array<string, mixed>>, layouts: array<string, list<array<string, mixed>>>, omitted: array{panels: list<array{id: string, title: string, devices: list<string>}>, sources: list<array{panel: string, device_uuid: string}>, references: list<array{panel: string, kind: string, uuid: string}>}}
     */
    public static function rewrite(array $widgets, array $layouts, array $devices, array $parameters, array $references, bool $keepOnly): array
    {
        $kept = [];
        $omitted = ['panels' => [], 'sources' => [], 'references' => []];
        foreach ($widgets as $widget) {
            $config = $widget['config'] ?? [];
            $title = (string) ($widget['title'] ?? '');
            $dropped = [];
            $droppedReferences = [];
            if (isset($config['sources'])) {
                $sources = [];
                foreach ($config['sources'] as $source) {
                    $device = $devices[$source['device_uuid'] ?? ''] ?? null;
                    $parameter = $parameters[$source['parameter_uuid'] ?? ''] ?? null;
                    if ($device !== null && $parameter !== null) {
                        $sources[] = [...$source, 'device_uuid' => $device, 'parameter_uuid' => $parameter];
                    } else {
                        $dropped[] = (string) ($source['device_uuid'] ?? '');
                    }
                }
                $config['sources'] = $sources;
            }
            if (isset($config['devices'])) {
                $entries = [];
                foreach ($config['devices'] as $entry) {
                    if (($device = $devices[$entry['device_uuid'] ?? ''] ?? null) !== null) {
                        $entries[] = [...$entry, 'device_uuid' => $device];
                    } else {
                        $dropped[] = (string) ($entry['device_uuid'] ?? '');
                    }
                }
                $config['devices'] = $entries;
            }
            if (isset($config['location_device_uuids'])) {
                $located = [];
                foreach ($config['location_device_uuids'] as $uuid) {
                    if (($device = $devices[$uuid] ?? null) !== null) {
                        $located[] = $device;
                    } else {
                        $dropped[] = (string) $uuid;
                    }
                }
                $config['location_device_uuids'] = $located;
            }
            foreach (['workflow_uuid' => 'workflow', 'geofence_uuid' => 'geofence'] as $key => $kind) {
                if (! isset($config[$key])) {
                    continue;
                }
                if (isset($references[$config[$key]])) {
                    $config[$key] = $references[$config[$key]];
                } else {
                    $droppedReferences[] = ['panel' => $title, 'kind' => $kind, 'uuid' => (string) $config[$key]];
                    unset($config[$key]);
                }
            }

            $mapped = count($config['sources'] ?? []) + count($config['devices'] ?? []) + count($config['location_device_uuids'] ?? []) + (isset($config['workflow_uuid']) ? 1 : 0);
            $shows = match ($widget['type'] ?? null) {
                'text' => ! $keepOnly,
                'alerts' => isset($config['workflow_uuid']),
                'location' => ($config['location_device_uuids'] ?? []) !== [] || isset($config['workflow_uuid']),
                'device_health' => ($config['devices'] ?? []) !== [],
                default => ($config['sources'] ?? []) !== [],
            };
            if (! $shows || ($keepOnly && $mapped === 0)) {
                $omitted['panels'][] = ['id' => (string) $widget['id'], 'title' => $title, 'devices' => self::named($widget)];

                continue;
            }
            foreach (array_unique($dropped) as $uuid) {
                $omitted['sources'][] = ['panel' => $title, 'device_uuid' => $uuid];
            }
            array_push($omitted['references'], ...$droppedReferences);
            $kept[] = [...$widget, 'config' => $config];
        }

        $ids = array_flip(array_column($omitted['panels'], 'id'));
        $rewritten = [];
        foreach ($layouts as $breakpoint => $items) {
            $rewritten[$breakpoint] = array_values(array_filter($items, fn (array $item): bool => ! isset($ids[(string) ($item['i'] ?? '')])));
        }

        return ['widgets' => $kept, 'layouts' => $rewritten, 'omitted' => $omitted];
    }

    /**
     * The device UUIDs a dashboard's panels name, each once.
     *
     * @param  list<array<string, mixed>>  $widgets
     * @return list<string>
     */
    public static function devices(array $widgets): array
    {
        return array_values(array_unique(array_merge([], ...array_map(self::named(...), $widgets))));
    }

    /**
     * @param  array<string, mixed>  $widget
     * @return list<string>
     */
    private static function named(array $widget): array
    {
        $config = $widget['config'] ?? [];
        $uuids = [...array_column($config['sources'] ?? [], 'device_uuid'), ...array_column($config['devices'] ?? [], 'device_uuid'), ...($config['location_device_uuids'] ?? [])];

        return array_values(array_unique(array_filter($uuids, 'is_string')));
    }
}
