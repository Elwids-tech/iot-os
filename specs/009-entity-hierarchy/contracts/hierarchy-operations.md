# Hierarchy Operations: the in-process contract for other domains

What spec 038's hierarchy proposal (its research R16, pull request 8) and any later
import call. PHP only, inside `apps/api`; no HTTP route in v1 ([research
R13](../research.md#r13-hierarchy-operations-for-other-features-spec-038-research-r16)).
Ships in pull request 3. Classes are in `App\Domain\Entities`; callers never touch the
hierarchy's tables or models' write methods.

## Read: `Services\HierarchyQueries`

```php
/** @return list<EntityTypeView> key, name, top_level, parent_type_keys, member_type_keys, accepts_devices, naming */
public function types(Organization $organization): array;

/** Null when no active entity has that path (case-insensitive). */
public function findByPath(Organization $organization, string $path): ?EntityView;

/** @return list<EntityView> active children, all pages */
public function children(Organization $organization, ?string $parentUuid): array;

public function placementOf(Device $device): ?EntityView;
```

`EntityView` carries `uuid`, `name`, `path_name`, `path`, `type_key`, `parent_uuid`.

## Single changes: `Services\HierarchyOperations`

```php
public function createEntity(Organization $organization, NewEntity $entity, User $actor): EntityView;
public function placeDevice(Device $device, string $entityUuid, User $actor, array $leafNames = []): void;
public function endPlacement(Device $device, User $actor): void;
```

Each checks `Entity.manage` for `$actor` in the organization (`AuthorizationException`
otherwise), takes the locks of research R3, enforces every rule, updates derived device
columns, and records the activity entry a portal request would (FR-019). A refusal
throws `HierarchyRuleBroken` with `rule`, `field` and a message (the same texts as the
portal's `422`).

## Batches

```php
public function check(Organization $organization, HierarchyBatch $batch): BatchResult;
public function apply(Organization $organization, HierarchyBatch $batch, User $actor): BatchResult;
```

`HierarchyBatch` (1–2,000 items, in order):

```php
new NewEntityItem(
    ref: 'floor-3',                       // unique in the batch
    typeKey: 'floor',
    name: 'Floor 3',
    pathName: null,                       // suggested from the name when null (R11)
    parent: Parent::existing($uuid) | Parent::item('building-1') | Parent::topLevel(),
    timezone: null, address: null, latitude: null, longitude: null, attributes: [],
);

new PlacementItem(
    ref: 'place-vav-3-2',
    deviceUuid: $uuid,
    entity: Target::existing($uuid) | Target::item('zone-3-2'),
    leafNames: [],                        // parameter UUID => leaf name
);
```

`BatchResult`:

```php
$result->applied;                         // bool: true only after a committed apply
$result->items;                           // list of ItemOutcome, in batch order
// ItemOutcome: ref, outcome ('accepted' | 'refused'), rule (null | 'parent_type' |
//   'naming' | 'sibling_clash' | 'leaf_clash' | 'depth' | 'accepts_devices' |
//   'already_placed' | 'ceiling' | 'parent_refused' | 'not_found'), field, message,
//   entity_uuid (accepted entity items; the would-be UUID on check, the real one on apply)
```

Behaviour:

- `check` saves nothing, writes no activity and needs only `Entity.view` by the caller's
  own check; `apply` needs `Entity.manage` and commits only when every item is accepted.
  When any item is refused, `apply` returns the outcomes with `applied = false`.
- A placement of a device already placed elsewhere is refused with `already_placed`;
  the caller decides whether to end the old placement first (spec 038 offers additions
  only).
- A device or entity UUID of another organization, or unknown, is `not_found`
  (constitution III).
- The checks are the code that runs on apply, inside a rolled-back transaction, so a
  check and an immediate apply agree unless someone changed the tree in between.
- Nothing in an item or in the hierarchy records where the batch came from; the caller
  stores its own provenance (FR-025). Activity entries carry `context.batch`.

## Tests the hierarchy owns

- check saves nothing (row counts and activity log unchanged);
- every rule refused in check is refused identically in apply;
- refs forward and backward, a refused parent refusing its children;
- all-or-nothing apply;
- another organization's UUIDs are `not_found`;
- the schema test that no hierarchy column names a protocol or node address.
