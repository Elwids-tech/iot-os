<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/**
 * A move as one person sees it (spec 031, contract § Move). Each side is named, but only
 * a member of an organization sees its uuids: predecessors to members of the source,
 * successors and how they arrived to members of the target.
 */
final class MoveView
{
    public static function for(DeviceMove $move, User $viewer): array
    {
        $source = Organization::withTrashed()->find($move->source_organization_id);
        $target = Organization::withTrashed()->find($move->target_organization_id);
        $inSource = self::member($viewer, $source);
        $inTarget = self::member($viewer, $target);
        $rows = $move->devices()->with(['predecessor:id,uuid,name', 'successor'])->get();
        $attention = [];
        $devices = $rows->map(function (DeviceMoveDevice $row) use ($inSource, $inTarget, $target, &$attention): array {
            [$state, $reason] = $row->successor ? self::successorState($row->successor, $row) : [null, null];
            if ($inTarget && $row->successor && in_array($state, ['inactive', 'failed'], true) && $row->was_active) {
                $attention[] = ['kind' => 'device', 'uuid' => $row->successor->uuid, 'name' => $row->successor->name,
                    'reason' => $reason ?? 'Activate it in '.$target->name.'.'];
            }

            return [
                'predecessor_uuid' => $inSource ? $row->predecessor->uuid : null,
                'successor_uuid' => $inTarget ? $row->successor?->uuid : null,
                'name' => $inTarget ? ($row->successor->name ?? $row->name) : $row->predecessor->name,
                'state' => $row->state,
                'successor_state' => $inTarget ? $state : null,
                'successor_reason' => $inTarget ? $reason : null,
            ];
        })->values()->all();

        return [
            'uuid' => $move->uuid,
            'status' => $move->status,
            'source' => ['uuid' => $inSource ? $source?->uuid : null, 'name' => $source?->name],
            'target' => ['uuid' => $inTarget ? $target?->uuid : null, 'name' => $target?->name],
            'confirmed_at' => $move->confirmed_at?->toJSON(),
            'cutover_at' => $move->cutover_at?->toJSON(),
            'waiting_for' => ['devices_stopping' => $move->status === 'stopping' ? $rows->where('state', 'stopping')->count() : 0],
            'devices' => $devices,
            'items' => [],
            'needs_attention' => $attention,
            'failure_reason' => $move->failure_reason,
        ];
    }

    /**
     * `pending`, `active`, `inactive` or `failed`, with the reason the runtime or the
     * activation gave for a failure.
     *
     * @return array{0: string, 1: ?string}
     */
    private static function successorState(Device $successor, DeviceMoveDevice $row): array
    {
        return match (true) {
            $successor->deployment_status === 'pending' => ['pending', null],
            $successor->deployment_status === 'failed' => ['failed', $successor->diagnostic],
            $successor->lifecycle === 'active' => ['active', null],
            $row->arrives_active && $successor->diagnostic !== null => ['failed', $successor->diagnostic],
            default => ['inactive', null],
        };
    }

    private static function member(User $user, ?Organization $organization): bool
    {
        return $organization !== null && ($user->is_super_admin || $user->organizations()->whereKey($organization->id)->exists());
    }
}
