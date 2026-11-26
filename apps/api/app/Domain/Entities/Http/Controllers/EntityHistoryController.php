<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Services\EntityAuthorization;
use App\Domain\Entities\Services\EntityHistory;
use App\Domain\Shared\Models\Organization;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Where things were, and when (spec 009 US6, FR-012). The service is resolved inside each
 * action so Scramble documents the response from the docblocks, not from the service.
 */
final class EntityHistoryController
{
    public function __construct(private readonly EntityAuthorization $authorization) {}

    /**
     * The entity's history, newest first, 50 a page: its moves, renames, type changes,
     * archiving and restoring, the devices and points placed at it and taken away, and the
     * groups it joined and left. A start with a null `at` is from before history was kept.
     *
     * @return array{data: list<array{id: string, kind: 'created'|'moved'|'renamed'|'retyped'|'archived'|'restored'|'device_placed'|'device_removed'|'point_placed'|'point_removed'|'joined_group'|'left_group'|'member_added'|'member_removed', at: string|null, user: array{id: int, name: string}|null, old_parent?: array{uuid: string, name: string, path: string}|null, new_parent?: array{uuid: string, name: string, path: string}|null, old_path_name?: string|null, new_path_name?: string|null, old_type?: array{key: string, name: string}|null, new_type?: array{key: string, name: string}|null, entity?: array{uuid: string, name: string, path: string}|null, device?: array{uuid: string, name: string}|null, parameter?: array{uuid: string, key: string, leaf_name: string}, member?: array{uuid: string, name: string, path: string}|null, group?: array{uuid: string, name: string, path: string}|null, end_reason?: string|null}>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    #[QueryParameter('page', type: 'int')]
    public function entity(Request $request, Organization $organization, Entity $entity): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization, $entity);
        $filters = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);

        return app(EntityHistory::class)->forEntity($entity, (int) ($filters['page'] ?? 1));
    }

    /**
     * The devices and points placed in the entity's branch at a past time, using the tree
     * as it was then (moves and creations after it are undone), by device name. `existed`
     * is false when the entity had not been created yet.
     *
     * @return array{data: list<array{kind: 'device'|'point', device: array{uuid: string, name: string}, entity: array{uuid: string, name: string, path: string}|null, parameter_key: string|null, leaf_name: string|null, started_at: string|null, ended_at: string|null}>, meta: array{current_page: int, last_page: int, per_page: int, total: int, existed: bool}}
     */
    #[QueryParameter('time', description: 'An ISO 8601 time, no later than now.', required: true)]
    #[QueryParameter('page', type: 'int')]
    public function branchAt(Request $request, Organization $organization, Entity $entity): array
    {
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization, $entity);
        $filters = $request->validate(['time' => ['required', 'date', 'before_or_equal:now'], 'page' => ['sometimes', 'integer', 'min:1']]);

        return app(EntityHistory::class)->branchAt($entity, Carbon::parse($filters['time'])->utc(), (int) ($filters['page'] ?? 1));
    }

    /**
     * The device's placements and its parameters' own placements, newest first, 50 a page,
     * with who made each change. A start with a null `at` is from before history was kept.
     *
     * @return array{data: list<array{id: string, kind: 'device_placed'|'device_removed'|'point_placed'|'point_removed', at: string|null, user: array{id: int, name: string}|null, entity: array{uuid: string, name: string, path: string}|null, device: array{uuid: string, name: string}|null, parameter?: array{uuid: string, key: string, leaf_name: string}, end_reason: string|null}>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    #[QueryParameter('page', type: 'int')]
    public function device(Request $request, Organization $organization, Device $device): array
    {
        app(DeviceAuthorization::class)->authorize($request->user(), DevicePermission::VIEW, $organization, $device);
        $this->authorization->authorize($request->user(), EntityPermission::VIEW, $organization);
        $filters = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);

        return app(EntityHistory::class)->forDevice($device, (int) ($filters['page'] ?? 1));
    }
}
