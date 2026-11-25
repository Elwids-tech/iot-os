<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Exceptions\HierarchyRuleBroken;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Entities\Permissions\EntityPermission;
use App\Domain\Entities\Services\Batch\BatchResult;
use App\Domain\Entities\Services\Batch\EntityRef;
use App\Domain\Entities\Services\Batch\HierarchyBatch;
use App\Domain\Entities\Services\Batch\ItemOutcome;
use App\Domain\Entities\Services\Batch\NewEntityItem;
use App\Domain\Entities\Services\Batch\PlacementItem;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * The only way another feature changes the hierarchy (spec 009, FR-024, research R13;
 * the first caller is spec 038's hierarchy proposal). Each operation runs the code a
 * person's portal request runs: the same permission, locks, rules, derived device
 * columns and activity entries. Nothing here or in the hierarchy records where a change
 * came from; callers keep their own provenance (FR-025).
 *
 * `check` runs a batch for real inside a transaction it always rolls back, with a
 * savepoint per item, so a check never disagrees with the apply that follows it unless
 * someone changed the tree in between. `apply` runs the batch again and commits only
 * when every item is accepted.
 */
final class HierarchyOperations
{
    public function __construct(
        private readonly EntityTree $tree,
        private readonly Placements $placements,
        private readonly EntityAuthorization $authorization,
    ) {}

    /** Creates one entity as a person with `Entity.manage` would. */
    public function createEntity(Organization $organization, NewEntityItem $item, User $actor): Entity
    {
        $this->authorize($actor, $organization, EntityPermission::MANAGE);

        return DB::transaction(fn (): Entity => $this->create($organization, $item, $actor, []));
    }

    /**
     * Places a device of the organization at one of its entities.
     *
     * @param  array<string, string>  $leafNames
     */
    public function placeDevice(Device $device, string $entityUuid, User $actor, array $leafNames = []): void
    {
        $this->authorize($actor, $device->organization, EntityPermission::MANAGE);
        $entity = Entity::query()->where('organization_id', $device->organization_id)->where('uuid', $entityUuid)->first()
            ?? throw HierarchyRuleBroken::rule('not_found', 'entity_uuid', 'Choose a place in this device\'s organization.');
        $this->placements->place($device, $entity, $actor, $leafNames);
    }

    public function endPlacement(Device $device, User $actor): void
    {
        $this->authorize($actor, $device->organization, EntityPermission::MANAGE);
        $this->placements->end($device, $actor);
    }

    /** Every item accepted or refused with its rule; nothing is saved and nothing is logged. */
    public function check(Organization $organization, HierarchyBatch $batch, User $actor): BatchResult
    {
        $this->authorize($actor, $organization, EntityPermission::VIEW);
        DB::beginTransaction();
        try {
            return new BatchResult(false, $this->run($organization, $batch, $actor, false));
        } finally {
            DB::rollBack();
        }
    }

    /**
     * All or nothing: re-checked now, committed only when every item is accepted. Each
     * change records the activity entry the portal would, with `batch` set to the
     * result's `batchUuid`.
     */
    public function apply(Organization $organization, HierarchyBatch $batch, User $actor): BatchResult
    {
        $this->authorize($actor, $organization, EntityPermission::MANAGE);
        $batchUuid = (string) Str::uuid();
        DB::beginTransaction();
        try {
            $outcomes = ActivityLog::within(['batch' => $batchUuid], fn (): array => $this->run($organization, $batch, $actor, true));
            $accepted = array_filter($outcomes, fn (ItemOutcome $item): bool => ! $item->accepted()) === [];
            if (! $accepted) {
                DB::rollBack();

                return new BatchResult(false, array_map(fn (ItemOutcome $item) => new ItemOutcome($item->ref, $item->outcome, $item->rule, $item->field, $item->message), $outcomes));
            }
            DB::commit();

            return new BatchResult(true, $outcomes, $batchUuid);
        } catch (Throwable $exception) {
            DB::rollBack();
            throw $exception;
        }
    }

    /**
     * @return list<ItemOutcome>
     */
    private function run(Organization $organization, HierarchyBatch $batch, User $actor, bool $applying): array
    {
        /** @var array<string, ?Entity> $created ref => entity, null when the item was refused */
        $created = [];
        $outcomes = [];
        foreach ($batch->items as $item) {
            $target = $item instanceof NewEntityItem ? $item->parent : $item->entity;
            if ($target->ref !== null && ($created[$target->ref] ?? null) === null) {
                $outcomes[] = new ItemOutcome($item->ref, 'refused', 'parent_refused', $item instanceof NewEntityItem ? 'parent' : 'entity', "{$target->ref} was refused, so this item cannot be applied.");
                $created[$item->ref] = null;

                continue;
            }
            try {
                // A savepoint per item: a refusal undoes only that item.
                $entity = DB::transaction(fn () => $item instanceof NewEntityItem
                    ? $this->create($organization, $item, $actor, $created)
                    : $this->place($organization, $item, $actor, $created));
                if ($item instanceof NewEntityItem) {
                    $created[$item->ref] = $entity;
                }
                $outcomes[] = new ItemOutcome($item->ref, 'accepted', entityUuid: $applying && $item instanceof NewEntityItem ? $entity->uuid : null);
            } catch (HierarchyRuleBroken $refusal) {
                $created[$item->ref] = null;
                $outcomes[] = new ItemOutcome($item->ref, 'refused', $refusal->rule, $refusal->field, $refusal->message());
            }
        }

        return $outcomes;
    }

    /** @param  array<string, ?Entity>  $created */
    private function create(Organization $organization, NewEntityItem $item, User $actor, array $created): Entity
    {
        $parent = $this->resolve($organization, $item->parent, $created, 'parent');

        return $this->tree->create($organization, [
            'type_key' => $item->typeKey, 'parent_uuid' => $parent?->uuid, 'name' => $item->name, 'path_name' => $item->pathName,
            ...($item->timezone !== null ? ['timezone' => $item->timezone] : []),
            ...($item->address !== null ? ['address' => $item->address] : []),
            ...($item->latitude !== null ? ['latitude' => $item->latitude, 'longitude' => $item->longitude] : []),
            ...($item->attributes !== [] ? ['attributes' => $item->attributes] : []),
        ], $actor);
    }

    /** @param  array<string, ?Entity>  $created */
    private function place(Organization $organization, PlacementItem $item, User $actor, array $created): Entity
    {
        $entity = $this->resolve($organization, $item->entity, $created, 'entity');
        $device = Device::query()->where('organization_id', $organization->id)->where('uuid', $item->deviceUuid)->first()
            ?? throw HierarchyRuleBroken::rule('not_found', 'device', 'Choose a device of this organization.');
        $current = EntityPlacement::query()->with('entity')->where('device_id', $device->id)->whereNull('ended_at')->first();
        if ($current && $current->entity_id !== $entity->id) {
            throw HierarchyRuleBroken::rule('already_placed', 'device', "{$device->name} is already placed at {$current->entity->path}.");
        }
        $this->placements->place($device, $entity, $actor, $item->leafNames);

        return $entity;
    }

    /** @param  array<string, ?Entity>  $created */
    private function resolve(Organization $organization, EntityRef $ref, array $created, string $field): ?Entity
    {
        if ($ref->ref !== null) {
            return $created[$ref->ref];
        }
        if ($ref->uuid === null) {
            return null;
        }

        return Entity::query()->where('organization_id', $organization->id)->where('uuid', $ref->uuid)->first()
            ?? throw HierarchyRuleBroken::rule('not_found', $field, 'Choose an entity of this organization.');
    }

    private function authorize(User $actor, Organization $organization, EntityPermission $permission): void
    {
        if (! $this->authorization->allows($actor, $permission, $organization)) {
            throw new AuthorizationException("This needs {$permission->value} in {$organization->name}.");
        }
    }
}
