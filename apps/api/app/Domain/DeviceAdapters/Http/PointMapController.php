<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Http;

use App\Domain\DeviceAdapters\Models\AdapterConnection;
use App\Domain\DeviceAdapters\Services\Connections;
use App\Domain\DeviceAdapters\Services\PointMaps;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthorization;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

/**
 * Building a point map (spec 038 US3, contracts/api.md): similar equipment, readings
 * suggested from the server, and a new device type made from the readings.
 */
final class PointMapController
{
    public function __construct(
        private readonly Connections $connections,
        private readonly PointMaps $pointMaps,
        private readonly DeviceAuthorization $authorization,
        private readonly DeviceProfileAuthorization $profiles,
    ) {}

    private function authorize(Request $r, Organization $organization, ?AdapterConnection $connection = null): void
    {
        abort_unless(config('adapters.enabled'), 404);
        $this->authorization->authorize($r->user(), DevicePermission::MANAGE, $organization, $connection);
    }

    /** Equipment like one mapped, by declared type, matching point names or a tag pattern (FR-022). */
    public function similar(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);
        $v = $r->validate([
            'equipment' => 'required|array', 'equipment.node' => 'nullable|string|max:4200',
            'equipment.path' => 'required|array|min:1|max:32', 'equipment.path.*.namespace_uri' => 'required|string|max:512', 'equipment.path.*.name' => 'required|string|max:512',
            'points' => 'required|array|min:1|max:500', 'points.*.key' => 'required|string|max:255', 'points.*.name' => 'required_unless:by,pattern|nullable|string|max:512', 'points.*.pattern' => 'required_if:by,pattern|nullable|string|max:512',
            'by' => 'required|in:type,names,pattern', 'root' => 'nullable|string|max:4200',
        ]);
        $node = AdapterConnectionController::address($v['equipment']['node'] ?? null);
        $last = end($v['equipment']['path']);
        $equipment = ['node_id' => $node['node_id'] ?? null, 'namespace_uri' => $node['namespace_uri'] ?? $last['namespace_uri'], 'path' => array_values($v['equipment']['path'])];
        $points = array_map(fn ($p) => array_filter(['key' => $p['key'], 'name' => $p['name'] ?? null, 'pattern' => $p['pattern'] ?? null], fn ($x) => $x !== null), $v['points']);

        return ['data' => $this->connections->similar($connection, $equipment, $points, $v['by'], AdapterConnectionController::address($v['root'] ?? null))];
    }

    /** Readings suggested from ticked points: key, name, unit, data type, range, reporting (FR-023). */
    public function suggest(Request $r, Organization $organization, AdapterConnection $connection): array
    {
        $this->authorize($r, $organization, $connection);
        $v = $r->validate(['points' => 'required|array|min:1|max:200', 'points.*.node' => 'required|string|max:4200', 'points.*.name' => 'required|string|max:512', 'points.*.display_name' => 'nullable|string|max:512']);
        $read = $this->connections->read($connection, array_map(fn ($p) => AdapterConnectionController::address($p['node']), $v['points']))['points'] ?? [];
        $points = [];
        $refused = [];
        foreach ($v['points'] as $i => $point) {
            $value = $read[$i] ?? [];
            if (($value['storable'] ?? false) !== true) {
                $refused[] = ['node' => $point['node'], 'name' => $point['name'], 'reason' => $value['not_storable'] ?? 'The platform cannot store this point.'];

                continue;
            }
            $points[] = [...$value, 'name' => $point['name'], 'display_name' => $point['display_name'] ?? $point['name']];
        }

        return ['data' => ['readings' => $this->pointMaps->suggest($points), 'refused' => $refused]];
    }

    /** A new device type whose readings are the map's, published at once (FR-023). */
    public function deviceType(Request $r, Organization $organization): array
    {
        $this->authorize($r, $organization);
        $this->profiles->authorize($r->user(), DeviceProfilePermission::CREATE);
        $this->profiles->authorize($r->user(), DeviceProfilePermission::PUBLISH);
        $v = $r->validate([
            'name' => 'required|string|max:255', 'readings' => 'required|array|min:1|max:500',
            'readings.*.key' => ['required', 'string', 'max:255', 'regex:/^[a-zA-Z][a-zA-Z0-9._-]*$/', 'distinct'], 'readings.*.name' => 'required|string|max:120',
            'readings.*.data_type' => 'required|in:number,boolean,state,text', 'readings.*.unit' => 'nullable|string|max:32',
        ]);
        $artifact = $this->pointMaps->deviceType($organization, $r->user(), $v['name'], $v['readings']);

        return ['data' => ['artifact_uuid' => $artifact->uuid, 'profile_uuid' => $artifact->profile->uuid, 'name' => $artifact->profile->name, 'revision' => $artifact->revision]];
    }
}
