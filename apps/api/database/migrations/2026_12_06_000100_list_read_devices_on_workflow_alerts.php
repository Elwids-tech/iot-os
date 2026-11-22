<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A workflow alert lists every device its execution reads (spec 037, FR-025, FR-029).
 * Until now it listed the first binding only, so an automation that reads two devices
 * showed its alerts for one of them. For each execution snapshot that names parameter
 * sources, the list becomes the devices those sources read: missing ones are added and
 * a device the automation only commands is removed (FR-026). Snapshots that name no
 * source, and geofence rules, keep the one device they list.
 *
 * The rule is written out here, not taken from DeploymentGraph, so the migration keeps
 * working when that class changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('automation_deployments')
            ->whereIn('id', DB::table('automation_alerts')->where('kind', 'workflow')->whereNotNull('automation_deployment_id')->select('automation_deployment_id'))
            ->select(['id', 'definition'])->orderBy('id')
            ->chunkById(200, function ($deployments): void {
                foreach ($deployments as $deployment) {
                    $read = $this->readDeviceUuids(json_decode((string) $deployment->definition, true));
                    if ($read === null) {
                        continue;
                    }
                    $alerts = DB::table('automation_alerts')->where('kind', 'workflow')->where('automation_deployment_id', $deployment->id)->get(['id', 'organization_id']);
                    foreach ($alerts->groupBy('organization_id') as $organization => $theirs) {
                        $devices = $read === [] ? [] : DB::table('devices')->where('organization_id', $organization)->whereIn('uuid', $read)->pluck('id')->all();
                        foreach ($theirs as $alert) {
                            DB::table('automation_alert_devices')->where('automation_alert_id', $alert->id)->whereNotIn('device_id', $devices)->delete();
                            DB::table('automation_alert_devices')->insertOrIgnore(array_map(fn ($device): array => ['automation_alert_id' => $alert->id, 'device_id' => $device], $devices));
                        }
                    }
                }
            });
    }

    /** The earlier list is a valid one for the earlier code, and which rows were added is not recorded. */
    public function down(): void {}

    /**
     * The devices of the bindings that parameter sources name; null when the snapshot
     * names no source, which leaves its alerts as they are.
     *
     * @return list<string>|null
     */
    private function readDeviceUuids(mixed $definition): ?array
    {
        if (! is_array($definition)) {
            return null;
        }
        $roles = [];
        foreach ((array) ($definition['nodes'] ?? []) as $node) {
            $role = is_array($node) && ($node['type'] ?? null) === 'source.parameter.v1' ? ($node['config']['binding'] ?? null) : null;
            if (is_string($role) && $role !== '') {
                $roles[$role] = true;
            }
        }
        if ($roles === []) {
            return null;
        }
        $uuids = [];
        foreach ((array) ($definition['bindings'] ?? []) as $binding) {
            $uuid = is_array($binding) && isset($roles[$binding['role'] ?? '']) ? ($binding['device_uuid'] ?? null) : null;
            if (is_string($uuid) && Str::isUuid($uuid)) {
                $uuids[$uuid] = true;
            }
        }

        return array_keys($uuids);
    }
};
