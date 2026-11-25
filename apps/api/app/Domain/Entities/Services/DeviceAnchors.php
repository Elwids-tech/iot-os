<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityType;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The only writer of the two derived device columns (spec 009, research R5):
 *
 * - `devices.entity_id`, the anchor: where the device is placed now, or, once archived,
 *   where it was placed last;
 * - `devices.site_id`: the nearest Site entity at or above the anchor.
 *
 * Every reader that filters or groups by site or branch (the directory, alerts, grants,
 * agent tools) stays one indexed join. Callers run these in their own transaction.
 */
final class DeviceAnchors
{
    /** Re-reads the anchor from the placements, then the site, for these devices. */
    public function refreshDevices(array $deviceIds): void
    {
        if ($deviceIds === []) {
            return;
        }
        $current = 'SELECT p.entity_id FROM entity_placements p WHERE p.device_id = devices.id AND p.ended_at IS NULL';
        $last = 'SELECT p.entity_id FROM entity_placements p WHERE p.device_id = devices.id ORDER BY p.ended_at IS NULL DESC, p.ended_at DESC, p.id DESC LIMIT 1';
        DB::table('devices')->whereIn('id', $deviceIds)->update([
            'entity_id' => DB::raw("CASE WHEN lifecycle = 'archived' THEN ({$last}) ELSE ({$current}) END"),
        ]);
        $this->refreshSites(DB::table('devices')->whereIn('id', $deviceIds));
    }

    /** Re-derives the site of every device anchored in the entity's branch (after a move or retype). */
    public function refreshBranch(Entity $entity): void
    {
        $this->refreshSites(DB::table('devices')->whereIn('entity_id', DB::table('entity_closure')->select('descendant_id')->where('ancestor_id', $entity->id)));
    }

    /**
     * The nearest time zone at or above the device's anchor, else its organization's, else
     * UTC (FR-013). A device whose site was set without a placement (old fixtures) uses
     * that site's zone.
     */
    public function timezone(Device $device): string
    {
        if ($device->entity_id !== null) {
            $zone = DB::table('entity_closure')->join('entities', 'entities.id', '=', 'entity_closure.ancestor_id')
                ->where('entity_closure.descendant_id', $device->entity_id)->whereNotNull('entities.timezone')
                ->orderBy('entity_closure.depth')->value('entities.timezone');
            if ($zone !== null) {
                return (string) $zone;
            }
        } elseif ($device->site_id !== null) {
            $zone = $device->site?->timezone;
            if ($zone !== null) {
                return (string) $zone;
            }
        }

        return $device->organization?->timezone ?? 'UTC';
    }

    /** The nearest Site entity at or above an entity, or null. */
    public function siteOf(?int $entityId): ?int
    {
        if ($entityId === null) {
            return null;
        }
        $id = DB::table('entity_closure')->join('entities', 'entities.id', '=', 'entity_closure.ancestor_id')
            ->join('entity_types', 'entity_types.id', '=', 'entities.entity_type_id')
            ->where('entity_closure.descendant_id', $entityId)->where('entity_types.key', EntityType::SITE)
            ->orderBy('entity_closure.depth')->value('entities.id');

        return $id === null ? null : (int) $id;
    }

    private function refreshSites(Builder $devices): void
    {
        $nearestSite = 'SELECT c.ancestor_id FROM entity_closure c JOIN entities e ON e.id = c.ancestor_id JOIN entity_types t ON t.id = e.entity_type_id'
            ." WHERE c.descendant_id = devices.entity_id AND t.key = '".EntityType::SITE."' ORDER BY c.depth LIMIT 1";
        $devices->update(['site_id' => DB::raw("CASE WHEN entity_id IS NULL THEN NULL ELSE ({$nearestSite}) END")]);
    }
}
