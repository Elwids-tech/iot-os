<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Where devices are (spec 009, FR-009). A device has at most one current placement, at an
 * active entity of its own organization whose type accepts devices. Moving it ends the
 * current placement at that moment and starts the next; nothing is deleted, so the
 * placements are its history (FR-012).
 */
final class Placements
{
    public function __construct(private readonly DeviceAnchors $anchors) {}

    /**
     * Places the device at the entity. `$log` is false when the caller records the change
     * itself (a device edit that also sets the site records one `device.updated`).
     *
     * @param  array<string, string>  $leafNames  parameter UUID => leaf name (PR 4)
     */
    public function place(Device $device, Entity $entity, ?User $actor, array $leafNames = [], bool $log = true): EntityPlacement
    {
        return DB::transaction(function () use ($device, $entity, $actor, $leafNames, $log): EntityPlacement {
            EntityTree::lock($device->organization);
            $entity = Entity::query()->with('type')->whereKey($entity->id)->firstOrFail();
            if ($entity->organization_id !== $device->organization_id) {
                throw ValidationException::withMessages(['entity_uuid' => 'Choose a place in this device\'s organization.']);
            }
            if ($entity->isArchived()) {
                throw ValidationException::withMessages(['entity_uuid' => "{$entity->name} is archived."]);
            }
            if (! $entity->type->accepts_devices) {
                throw ValidationException::withMessages(['entity_uuid' => "Devices cannot be placed on a {$entity->type->name}."]);
            }
            if ($device->lifecycle === 'archived') {
                throw ValidationException::withMessages(['entity_uuid' => 'Archived devices are read-only.']);
            }
            $current = $this->current($device);
            if ($current && $current->entity_id === $entity->id && ($current->leaf_names ?? []) === $leafNames) {
                return $current;
            }
            $now = now();
            $current?->forceFill(['ended_at' => $now, 'end_reason' => EntityPlacement::MOVED, 'ended_by' => $actor?->id])->save();
            $placement = EntityPlacement::create([
                'organization_id' => $device->organization_id, 'device_id' => $device->id, 'entity_id' => $entity->id,
                'leaf_names' => $leafNames === [] ? null : $leafNames, 'started_at' => $now, 'started_by' => $actor?->id,
            ]);
            $this->anchors->refreshDevices([$device->id]);
            if ($log) {
                ActivityLog::record('device.placed', $device->organization_id, $actor, $device, ['entity_uuid' => $entity->uuid, 'path' => $entity->path, 'from' => $current?->entity?->path]);
            }

            return $placement;
        });
    }

    /** Ends the current placement, if any: the device is no longer anywhere in the tree. */
    public function end(Device $device, ?User $actor, string $reason = EntityPlacement::UNPLACED, bool $log = true): void
    {
        DB::transaction(function () use ($device, $actor, $reason, $log): void {
            EntityTree::lock($device->organization);
            $current = $this->current($device);
            if (! $current) {
                return;
            }
            $current->forceFill(['ended_at' => now(), 'end_reason' => $reason, 'ended_by' => $actor?->id])->save();
            $this->anchors->refreshDevices([$device->id]);
            if ($log && $reason === EntityPlacement::UNPLACED) {
                ActivityLog::record('device.unplaced', $device->organization_id, $actor, $device, ['path' => $current->entity?->path]);
            }
        });
    }

    /**
     * For a device being archived (by a person or by a move to another organization):
     * its placement ends, and it keeps the place as its anchor (R5, US2 AS6). Call it once
     * the device is marked archived.
     */
    public function archived(Device $device, ?User $actor, string $reason = EntityPlacement::DEVICE_ARCHIVED): void
    {
        $this->end($device, $actor, $reason, false);
    }

    public function current(Device $device): ?EntityPlacement
    {
        return EntityPlacement::query()->with('entity')->where('device_id', $device->id)->whereNull('ended_at')->lockForUpdate()->first();
    }
}
