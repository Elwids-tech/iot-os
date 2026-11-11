<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Automation\Models\Workflow;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Models\DeviceMoveItem;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/**
 * A move as one person sees it (spec 031, contract § Move). Each side is named, but only
 * a member of an organization sees its uuids: predecessors and what stayed or was
 * archived to members of the source, successors and what moved or was copied, and how
 * they arrived, to members of the target.
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
            'items' => self::items($move, $inSource, $inTarget, $attention),
            'needs_attention' => $attention,
            'failure_reason' => $move->failure_reason,
        ];
    }

    /**
     * The dashboards and automations the move listed. Moved automations that arrived off,
     * or could not start, need someone in the target.
     *
     * @param  list<array<string, mixed>>  $attention
     * @return list<array<string, mixed>>
     */
    private static function items(DeviceMove $move, bool $inSource, bool $inTarget, array &$attention): array
    {
        $items = $move->items()->get();
        $models = [
            'dashboard' => Dashboard::whereIn('id', $items->where('kind', 'dashboard')->flatMap(fn (DeviceMoveItem $item) => [$item->source_item_id, $item->target_item_id])->filter())->get()->keyBy('id'),
            'automation' => Workflow::whereIn('id', $items->where('kind', 'automation')->flatMap(fn (DeviceMoveItem $item) => [$item->source_item_id, $item->target_item_id])->filter())->get()->keyBy('id'),
        ];

        return $items->map(function (DeviceMoveItem $item) use ($models, $inSource, $inTarget, &$attention): array {
            $source = $models[$item->kind]->get($item->source_item_id);
            $target = $item->target_item_id ? $models[$item->kind]->get($item->target_item_id) : null;
            if ($inTarget && $item->attention !== null && $target instanceof Workflow && $target->desired_deployment_uuid === null) {
                $attention[] = ['kind' => 'automation', 'uuid' => $target->uuid, 'name' => $target->name, 'reason' => $item->attention];
            }

            return [
                'kind' => $item->kind,
                'name' => $target->name ?? $source->name ?? null,
                'action' => $item->action,
                // A moved dashboard keeps its row, so only the target can open it.
                'source_uuid' => $inSource && $source && $item->target_item_id !== $item->source_item_id ? $source->uuid : null,
                'target_uuid' => $inTarget ? $target?->uuid : null,
                'arrives_running' => $item->arrives_running,
            ];
        })->values()->all();
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
