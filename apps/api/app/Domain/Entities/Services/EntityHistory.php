<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Models\Entity;
use App\Domain\Shared\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Where things were, and when (spec 009 US6, FR-012, research R12).
 *
 * The timeline merges an entity's own changes with the placements, parameter placements
 * and memberships that started or ended there, newest first. `branchAt` rebuilds the tree
 * at a past time from the change log and returns what was placed in the branch then.
 * Placements the site migration opened have no start: they count as open at any earlier
 * time and appear last in a timeline, "since before history was kept".
 */
final class EntityHistory
{
    public const PER_PAGE = 50;

    /**
     * @return array{data: list<array<string, mixed>>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    public function forEntity(Entity $entity, int $page): array
    {
        $id = $entity->id;
        $events = DB::table('entity_changes')->where('entity_id', $id)
            ->selectRaw("'change' AS source, id, kind, changed_at AS at, user_id")
            ->unionAll($this->periods('entity_placements', 'placement', 'device_placed', 'device_removed', fn (Builder $q) => $q->where('entity_id', $id)))
            ->unionAll($this->periods('parameter_placements', 'parameter_placement', 'point_placed', 'point_removed', fn (Builder $q) => $q->where('entity_id', $id)))
            ->unionAll($this->periods('entity_memberships', 'membership', 'joined_group', 'left_group', fn (Builder $q) => $q->where('member_id', $id)))
            ->unionAll($this->periods('entity_memberships', 'membership', 'member_added', 'member_removed', fn (Builder $q) => $q->where('group_id', $id)));

        return $this->page($events, $page);
    }

    /**
     * @return array{data: list<array<string, mixed>>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    public function forDevice(Device $device, int $page): array
    {
        $id = $device->id;
        $events = $this->periods('entity_placements', 'placement', 'device_placed', 'device_removed', fn (Builder $q) => $q->where('device_id', $id))
            ->unionAll($this->periods('parameter_placements', 'parameter_placement', 'point_placed', 'point_removed', fn (Builder $q) => $q->where('device_id', $id)));

        return $this->page($events, $page);
    }

    /**
     * The devices and points placed in the entity's branch at a past time, using the tree
     * as it was then. Devices by name; points follow their device.
     *
     * @return array{data: list<array{kind: 'device'|'point', device: array{uuid: string, name: string}, entity: array{uuid: string, name: string, path: string}, parameter_key: string|null, leaf_name: string|null, started_at: string|null, ended_at: string|null}>, meta: array{current_page: int, last_page: int, per_page: int, total: int, existed: bool}}
     */
    public function branchAt(Entity $entity, CarbonInterface $time, int $page): array
    {
        $branch = $this->branchIds($entity, $time);
        $open = fn (Builder $q) => $q->whereIn('p.entity_id', $branch)
            ->where(fn (Builder $q) => $q->whereNull('p.started_at')->orWhere('p.started_at', '<=', $time))
            ->where(fn (Builder $q) => $q->whereNull('p.ended_at')->orWhere('p.ended_at', '>', $time));
        $devices = DB::table('entity_placements AS p')->tap($open)
            ->selectRaw("'device' AS kind, p.device_id, p.entity_id, NULL AS parameter_key, NULL AS leaf_name, p.started_at, p.ended_at, 0 AS rank");
        $points = DB::table('parameter_placements AS p')->tap($open)
            ->selectRaw("'point' AS kind, p.device_id, p.entity_id, p.parameter_key, p.leaf_name, p.started_at, p.ended_at, 1 AS rank");
        $rows = DB::query()->fromSub($devices->unionAll($points), 'r')
            ->join('devices AS d', 'd.id', '=', 'r.device_id')
            ->select('r.*', 'd.uuid AS device_uuid', 'd.name AS device_name')
            ->orderBy('d.name')->orderBy('d.id')->orderBy('r.rank')->orderBy('r.leaf_name')
            ->paginate(self::PER_PAGE, ['*'], 'page', $page);
        $entities = Entity::query()->whereIn('id', collect($rows->items())->pluck('entity_id')->unique())->get()->keyBy('id');

        return [
            'data' => collect($rows->items())->map(fn (object $row): array => [
                'kind' => $row->kind,
                'device' => ['uuid' => (string) $row->device_uuid, 'name' => (string) $row->device_name],
                'entity' => $this->entitySummary($entities->get($row->entity_id)),
                'parameter_key' => $row->parameter_key,
                'leaf_name' => $row->leaf_name,
                'started_at' => $this->time($row->started_at),
                'ended_at' => $this->time($row->ended_at),
            ])->values()->all(),
            'meta' => [...$this->meta($rows), 'existed' => $branch !== []],
        ];
    }

    /**
     * The ids in the entity's branch at a time: each entity's parent then is the new parent
     * of its last `created` or `moved` change at or before it; with none, the old parent of
     * its first later move, or today's parent when nothing moved it. An entity whose first
     * change after the time is `created` did not exist yet.
     *
     * @return list<int>
     */
    public function branchIds(Entity $entity, CarbonInterface $time): array
    {
        $sql = <<<'SQL'
            WITH RECURSIVE
            before AS (
                SELECT DISTINCT ON (entity_id) entity_id, new_parent_id FROM entity_changes
                WHERE organization_id = :org1 AND kind IN ('created', 'moved') AND changed_at <= :time1
                ORDER BY entity_id, changed_at DESC, id DESC
            ),
            after AS (
                SELECT DISTINCT ON (entity_id) entity_id, kind, old_parent_id FROM entity_changes
                WHERE organization_id = :org2 AND kind IN ('created', 'moved') AND changed_at > :time2
                ORDER BY entity_id, changed_at, id
            ),
            parents AS (
                SELECT e.id,
                    CASE WHEN b.entity_id IS NOT NULL THEN b.new_parent_id WHEN a.kind = 'moved' THEN a.old_parent_id ELSE e.parent_id END AS parent_id
                FROM entities e
                LEFT JOIN before b ON b.entity_id = e.id
                LEFT JOIN after a ON a.entity_id = e.id
                WHERE e.organization_id = :org3 AND (b.entity_id IS NOT NULL OR a.kind IS DISTINCT FROM 'created')
            ),
            branch AS (
                SELECT id FROM parents WHERE id = :root
                UNION
                SELECT p.id FROM parents p JOIN branch ON p.parent_id = branch.id
            )
            SELECT id FROM branch
            SQL;

        return array_map(fn (object $row): int => (int) $row->id,
            DB::select($sql, ['org1' => $entity->organization_id, 'org2' => $entity->organization_id, 'org3' => $entity->organization_id, 'time1' => $utc = $time->copy()->utc()->toDateTimeString(), 'time2' => $utc, 'root' => $entity->id]));
    }

    /** Each period row twice: when it started (if known) and when it ended (if it has). */
    private function periods(string $table, string $source, string $started, string $ended, callable $scope): Builder
    {
        $starts = DB::table($table)->tap($scope)->selectRaw("'$source' AS source, id, '$started' AS kind, started_at AS at, started_by AS user_id");
        $ends = DB::table($table)->tap($scope)->whereNotNull('ended_at')->selectRaw("'$source' AS source, id, '$ended' AS kind, ended_at AS at, ended_by AS user_id");

        return $starts->unionAll($ends);
    }

    /**
     * @return array{data: list<array<string, mixed>>, meta: array{current_page: int, last_page: int, per_page: int, total: int}}
     */
    private function page(Builder $events, int $page): array
    {
        $rows = DB::query()->fromSub($events, 'h')
            // Undated starts are from before history was kept: oldest of all.
            ->orderByRaw('at IS NULL')->orderByDesc('at')
            ->orderByRaw("CASE WHEN kind IN ('device_removed', 'point_removed', 'left_group', 'member_removed') THEN 1 ELSE 0 END")
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $page);
        $items = collect($rows->items());
        $records = $this->records($items);

        return ['data' => $items->map(fn (object $row): array => $this->event($row, $records))->values()->all(), 'meta' => $this->meta($rows)];
    }

    /**
     * The rows behind a page of events, loaded once per table.
     *
     * @param  Collection<int, object>  $items
     * @return array<string, Collection<int, object>>
     */
    private function records(Collection $items): array
    {
        $ids = fn (string $source) => $items->where('source', $source)->pluck('id')->unique()->all();
        $records = [
            'change' => DB::table('entity_changes')->whereIn('id', $ids('change'))->get()->keyBy('id'),
            'placement' => DB::table('entity_placements')->whereIn('id', $ids('placement'))->get()->keyBy('id'),
            'parameter_placement' => DB::table('parameter_placements')->whereIn('id', $ids('parameter_placement'))->get()->keyBy('id'),
            'membership' => DB::table('entity_memberships')->whereIn('id', $ids('membership'))->get()->keyBy('id'),
        ];
        $entityIds = collect([
            ...$records['change']->flatMap(fn (object $c) => [$c->old_parent_id, $c->new_parent_id]),
            ...$records['placement']->pluck('entity_id'), ...$records['parameter_placement']->pluck('entity_id'),
            ...$records['membership']->flatMap(fn (object $m) => [$m->member_id, $m->group_id]),
        ])->filter()->unique();
        $typeIds = $records['change']->flatMap(fn (object $c) => [$c->old_type_id, $c->new_type_id])->filter()->unique();
        $deviceIds = $records['placement']->pluck('device_id')->merge($records['parameter_placement']->pluck('device_id'))->unique();

        return [
            ...$records,
            'entity' => Entity::query()->whereIn('id', $entityIds)->get()->keyBy('id'),
            'type' => DB::table('entity_types')->whereIn('id', $typeIds)->get(['id', 'key', 'name'])->keyBy('id'),
            'device' => DB::table('devices')->whereIn('id', $deviceIds)->get(['id', 'uuid', 'name'])->keyBy('id'),
            'user' => User::query()->whereIn('id', $items->pluck('user_id')->filter()->unique())->get(['id', 'name'])->keyBy('id'),
        ];
    }

    /**
     * @param  array<string, Collection<int, object>>  $records
     * @return array<string, mixed>
     */
    private function event(object $row, array $records): array
    {
        $record = $records[$row->source]->get($row->id);
        $user = $row->user_id === null ? null : $records['user']->get($row->user_id);
        $entity = fn (?int $id) => $id === null ? null : $this->entitySummary($records['entity']->get($id));
        $type = fn (?int $id) => ($found = $id === null ? null : $records['type']->get($id)) === null ? null : ['key' => (string) $found->key, 'name' => (string) $found->name];
        $device = fn (int $id) => ($found = $records['device']->get($id)) === null ? null : ['uuid' => (string) $found->uuid, 'name' => (string) $found->name];
        $ending = str_ends_with($row->kind, '_removed') || $row->kind === 'left_group';

        return [
            'id' => $row->source.':'.$row->id.':'.$row->kind,
            'kind' => $row->kind,
            'at' => $this->time($row->at),
            'user' => $user === null ? null : ['id' => (int) $user->id, 'name' => (string) $user->name],
            ...match ($row->source) {
                'change' => [
                    'old_parent' => $entity($record->old_parent_id), 'new_parent' => $entity($record->new_parent_id),
                    'old_path_name' => $record->old_path_name, 'new_path_name' => $record->new_path_name,
                    'old_type' => $type($record->old_type_id), 'new_type' => $type($record->new_type_id),
                ],
                'placement' => ['entity' => $entity($record->entity_id), 'device' => $device($record->device_id), 'end_reason' => $ending ? $record->end_reason : null],
                'parameter_placement' => [
                    'entity' => $entity($record->entity_id), 'device' => $device($record->device_id),
                    'parameter' => ['uuid' => (string) $record->parameter_uuid, 'key' => (string) $record->parameter_key, 'leaf_name' => (string) $record->leaf_name],
                    'end_reason' => $ending ? $record->end_reason : null,
                ],
                'membership' => ['member' => $entity($record->member_id), 'group' => $entity($record->group_id), 'end_reason' => $ending ? $record->end_reason : null],
            },
        ];
    }

    /** @return array{uuid: string, name: string, path: string}|null */
    private function entitySummary(?Entity $entity): ?array
    {
        return $entity === null ? null : ['uuid' => (string) $entity->uuid, 'name' => (string) $entity->name, 'path' => (string) $entity->path];
    }

    private function time(?string $value): ?string
    {
        return $value === null ? null : Carbon::parse($value)->toIso8601String();
    }

    /**
     * @param  LengthAwarePaginator<int, object>  $rows
     * @return array{current_page: int, last_page: int, per_page: int, total: int}
     */
    private function meta($rows): array
    {
        return ['current_page' => $rows->currentPage(), 'last_page' => $rows->lastPage(), 'per_page' => $rows->perPage(), 'total' => $rows->total()];
    }
}
