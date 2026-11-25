<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Exceptions\HierarchyRuleBroken;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\ParameterPlacement;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * One parameter placed at an entity on its own, under a leaf name (spec 009, FR-010):
 * channel 3 of a meter measures Floor 3. It overrides the device's placement for that
 * parameter; moving it ends the current one and starts the next.
 */
final class ParameterPlacements
{
    public function __construct(private readonly EntityPoints $points) {}

    public function place(Device $device, string $parameterUuid, Entity $entity, ?string $leafName, ?User $actor): ParameterPlacement
    {
        return DB::transaction(function () use ($device, $parameterUuid, $entity, $leafName, $actor): ParameterPlacement {
            EntityTree::lock($device->organization);
            $entity = Entity::query()->with('type')->whereKey($entity->id)->firstOrFail();
            if ($entity->organization_id !== $device->organization_id) {
                throw HierarchyRuleBroken::rule('not_found', 'entity_uuid', 'Choose a place in this device\'s organization.');
            }
            if ($entity->isArchived()) {
                throw HierarchyRuleBroken::rule('archived', 'entity_uuid', "{$entity->name} is archived.");
            }
            if (! $entity->type->accepts_devices) {
                throw HierarchyRuleBroken::rule('accepts_devices', 'entity_uuid', "Parameters cannot be placed on a {$entity->type->name}.");
            }
            if ($device->lifecycle === 'archived') {
                throw HierarchyRuleBroken::rule('archived', 'entity_uuid', 'Archived devices are read-only.');
            }
            $parameter = DeviceParameters::of($device)[$parameterUuid]
                ?? throw HierarchyRuleBroken::rule('not_found', 'parameter', 'This parameter is not in the device\'s current configuration.');
            $leafName = $leafName !== null && trim($leafName) !== '' ? trim($leafName) : $parameter['key'];
            if (! PathNames::valid($leafName)) {
                throw HierarchyRuleBroken::rule('invalid', 'leaf_name', PathNames::RULE);
            }
            $current = $this->current($device, $parameterUuid);
            if ($current && $current->entity_id === $entity->id && $current->leaf_name === $leafName) {
                return $current;
            }
            if (isset($this->points->namesAt($entity, [$device->id, $parameterUuid])[strtolower($leafName)])) {
                throw HierarchyRuleBroken::rule('leaf_clash', 'leaf_name', "{$leafName} is already used at {$entity->path}. Choose another leaf name.");
            }
            $now = now();
            $current?->forceFill(['ended_at' => $now, 'end_reason' => 'moved', 'ended_by' => $actor?->id])->save();
            $placement = ParameterPlacement::create([
                'organization_id' => $device->organization_id, 'device_id' => $device->id, 'parameter_uuid' => $parameterUuid,
                'parameter_key' => $parameter['key'], 'entity_id' => $entity->id, 'leaf_name' => $leafName, 'started_at' => $now, 'started_by' => $actor?->id,
            ]);
            ActivityLog::record('parameter.placed', $device->organization_id, $actor, $device, ['parameter' => $parameter['key'], 'path' => $entity->path.'/'.$leafName]);

            return $placement;
        });
    }

    /** The parameter goes back to the device's placement, if it has one. */
    public function end(Device $device, string $parameterUuid, ?User $actor): void
    {
        DB::transaction(function () use ($device, $parameterUuid, $actor): void {
            EntityTree::lock($device->organization);
            $current = $this->current($device, $parameterUuid);
            if (! $current) {
                return;
            }
            $current->forceFill(['ended_at' => now(), 'end_reason' => 'unplaced', 'ended_by' => $actor?->id])->save();
            ActivityLog::record('parameter.unplaced', $device->organization_id, $actor, $device, ['parameter' => $current->parameter_key, 'path' => $current->entity?->path.'/'.$current->leaf_name]);
        });
    }

    private function current(Device $device, string $parameterUuid): ?ParameterPlacement
    {
        return ParameterPlacement::query()->with('entity')->where('device_id', $device->id)->where('parameter_uuid', $parameterUuid)->whereNull('ended_at')->lockForUpdate()->first();
    }
}
