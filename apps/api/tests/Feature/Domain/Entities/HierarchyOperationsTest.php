<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Audit\Models\Activity;
use App\Domain\Devices\Models\Device;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityChange;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Entities\Services\Batch\EntityRef;
use App\Domain\Entities\Services\Batch\HierarchyBatch;
use App\Domain\Entities\Services\Batch\ItemOutcome;
use App\Domain\Entities\Services\Batch\NewEntityItem;
use App\Domain\Entities\Services\Batch\PlacementItem;
use App\Domain\Entities\Services\EntityPresets;
use App\Domain\Entities\Services\HierarchyOperations;
use App\Domain\Entities\Services\HierarchyQueries;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;

/** Spec 009 US7, FR-024, FR-025, SC-007: the operations other features call (spec 038 research R16). */
final class HierarchyOperationsTest extends EntityTestCase
{
    private User $actor;

    private HierarchyOperations $operations;

    /** @var list<Device> */
    private array $devices = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->actor = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $this->operations = app(HierarchyOperations::class);
        app(EntityPresets::class)->apply($this->organization, 'buildings', $this->actor);
        $this->site = app(HierarchyOperations::class)->createEntity($this->organization, new NewEntityItem('site', 'site', 'Tower campus', timezone: 'Europe/Berlin'), $this->actor);
        for ($n = 1; $n <= 20; $n++) {
            $this->devices[] = Device::create(['organization_id' => $this->organization->id, 'code' => "vav-{$n}", 'name' => "VAV {$n}"]);
        }
    }

    private Entity $site;

    /** One building, four floors, sixteen zones (by ref) and twenty placements: 41 items. */
    private function building(?string $breakZone = null): HierarchyBatch
    {
        $items = [new NewEntityItem('building', 'building', 'Example Tower', parent: EntityRef::existing($this->site->uuid))];
        for ($floor = 1; $floor <= 4; $floor++) {
            $items[] = new NewEntityItem("floor-{$floor}", 'floor', "Floor {$floor}", parent: EntityRef::item('building'));
            for ($zone = 1; $zone <= 4; $zone++) {
                $ref = "zone-{$floor}-{$zone}";
                // A zone may not sit under a building: the rule refuses it, and what hangs from it.
                $items[] = new NewEntityItem($ref, 'zone', "Zone {$floor}.{$zone}", parent: EntityRef::item($ref === $breakZone ? 'building' : "floor-{$floor}"));
            }
        }
        foreach ($this->devices as $i => $device) {
            $floor = intdiv($i, 4) % 4 + 1;
            $items[] = new PlacementItem("place-{$i}", $device->uuid, $i < 16 ? EntityRef::item('zone-'.$floor.'-'.($i % 4 + 1)) : EntityRef::item('floor-'.($i - 15)));
        }

        return new HierarchyBatch($items);
    }

    /** @return array<string, int> */
    private function counts(): array
    {
        return collect(['entities', 'entity_closure', 'entity_changes', 'entity_placements', 'activity_log'])->mapWithKeys(fn ($table) => [$table => DB::table($table)->count()])->all();
    }

    public function test_a_check_reports_every_item_and_saves_nothing(): void
    {
        $before = $this->counts();
        $started = microtime(true);
        $result = $this->operations->check($this->organization, $this->building(), $this->actor);
        $elapsed = microtime(true) - $started;

        $this->assertCount(41, $result->items);
        $this->assertTrue($result->accepted(), json_encode($result->refused()));
        $this->assertFalse($result->applied);
        $this->assertSame($before, $this->counts(), 'nothing saved, nothing logged');
        $this->assertLessThan(2.0, $elapsed, 'SC-007');
    }

    public function test_a_refused_item_refuses_what_depends_on_it_and_apply_is_all_or_nothing(): void
    {
        $batch = $this->building(breakZone: 'zone-2-3');
        $checked = $this->operations->check($this->organization, $batch, $this->actor);
        $refused = collect($checked->refused())->mapWithKeys(fn (ItemOutcome $item) => [$item->ref => $item->rule])->all();
        $this->assertSame(['zone-2-3' => 'parent_type', 'place-6' => 'parent_refused'], $refused);

        $before = $this->counts();
        $applied = $this->operations->apply($this->organization, $batch, $this->actor);
        $this->assertFalse($applied->applied);
        $this->assertSame($refused, collect($applied->refused())->mapWithKeys(fn (ItemOutcome $item) => [$item->ref => $item->rule])->all(), 'the apply refuses exactly what the check did');
        $this->assertSame($before, $this->counts());
        $this->assertNull($applied->items[0]->entityUuid);
    }

    public function test_an_accepted_batch_is_applied_as_ordinary_changes_tagged_with_the_batch(): void
    {
        $result = $this->operations->apply($this->organization, $this->building(), $this->actor);

        $this->assertTrue($result->applied);
        $building = Entity::where('uuid', $result->items[0]->entityUuid)->sole();
        $this->assertSame('TowerCampus/ExampleTower', $building->path);
        $this->assertSame(16, Entity::where('path', 'like', 'TowerCampus/ExampleTower/Floor%/Zone%')->count());
        $this->assertSame(20, EntityPlacement::whereNull('ended_at')->count());
        $this->assertSame('TowerCampus/ExampleTower/Floor1/Zone11', $this->devices[0]->fresh()->entity->path);
        $this->assertSame($this->site->id, $this->devices[19]->fresh()->site_id);
        $this->assertSame('Europe/Berlin', $this->devices[19]->fresh()->reportingTimezone());
        $logged = Activity::whereIn('event', ['entity.created', 'device.placed'])->get()->filter(fn (Activity $activity) => isset($activity->properties['batch']));
        $this->assertCount(41, $logged, 'one entry per change, each tagged with the batch');
        $this->assertSame([$result->batchUuid], $logged->map(fn (Activity $activity) => $activity->properties['batch'])->unique()->values()->all());
        $this->assertSame(1 + 21, EntityChange::where('kind', 'created')->count(), 'the site and the batch, as ordinary changes');

        // Applied again, every entity is refused as a clash: proposals offer additions only.
        $again = $this->operations->check($this->organization, $this->building(), $this->actor);
        $this->assertSame('sibling_clash', $again->items[0]->rule);
    }

    public function test_placements_are_additions_only_and_foreign_or_unknown_records_are_not_found(): void
    {
        $zone = $this->operations->createEntity($this->organization, new NewEntityItem('zone-host', 'building', 'Annex', parent: EntityRef::existing($this->site->uuid)), $this->actor);
        $this->operations->placeDevice($this->devices[0], $zone->uuid, $this->actor);

        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $foreignDevice = Device::create(['organization_id' => $northstar->id, 'code' => 'theirs', 'name' => 'Theirs']);
        $result = $this->operations->check($this->organization, new HierarchyBatch([
            new PlacementItem('moved', $this->devices[0]->uuid, EntityRef::existing($this->site->uuid)),
            new PlacementItem('same', $this->devices[0]->uuid, EntityRef::existing($zone->uuid)),
            new PlacementItem('foreign-device', $foreignDevice->uuid, EntityRef::existing($this->site->uuid)),
            new NewEntityItem('foreign-parent', 'building', 'Elsewhere', parent: EntityRef::existing((string) app(HierarchyOperations::class)->createEntity($northstar, new NewEntityItem('s', 'site', 'North yard', timezone: 'UTC'), User::where('email', 'northstar.admin@example.test')->firstOrFail())->uuid)),
            new NewEntityItem('unknown-type', 'tower', 'Tower'),
        ]), $this->actor);

        $this->assertSame(
            ['moved' => 'already_placed', 'same' => null, 'foreign-device' => 'not_found', 'foreign-parent' => 'not_found', 'unknown-type' => 'not_found'],
            collect($result->items)->mapWithKeys(fn (ItemOutcome $item) => [$item->ref => $item->rule])->all(),
        );
    }

    public function test_the_operations_need_the_hierarchy_permissions(): void
    {
        $member = User::where('email', 'acme.member@example.test')->firstOrFail();
        $this->assertTrue($this->operations->check($this->organization, $this->building(), $member)->accepted(), 'a viewer may check');
        $this->expectException(AuthorizationException::class);
        $this->operations->apply($this->organization, $this->building(), $member);
    }

    public function test_batches_are_bounded_and_refer_only_to_earlier_items(): void
    {
        foreach ([
            fn () => new HierarchyBatch([]),
            fn () => new HierarchyBatch([new NewEntityItem('a', 'zone', 'A', parent: EntityRef::item('b')), new NewEntityItem('b', 'floor', 'B')]),
            fn () => new HierarchyBatch([new NewEntityItem('a', 'zone', 'A'), new NewEntityItem('a', 'zone', 'A again')]),
            fn () => new HierarchyBatch(array_map(fn ($n) => new NewEntityItem("e{$n}", 'site', "E{$n}"), range(1, 2001))),
        ] as $i => $make) {
            try {
                $make();
                $this->fail("batch {$i} was accepted");
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_queries_give_types_paths_and_places_for_proposals(): void
    {
        $queries = app(HierarchyQueries::class);
        $this->operations->apply($this->organization, $this->building(), $this->actor);

        $this->assertContains('zone', array_column($queries->types($this->organization), 'key'));
        $this->assertSame('Example Tower', $queries->findByPath($this->organization, 'towercampus/exampletower/')['name']);
        $this->assertNull($queries->findByPath($this->organization, 'TowerCampus/Nowhere'));
        $this->assertSame(['Floor1', 'Floor2', 'Floor3', 'Floor4'], array_column($queries->children($this->organization, $queries->findByPath($this->organization, 'TowerCampus/ExampleTower')['uuid']), 'path_name'));
        $this->assertSame('zone', $queries->placementOf($this->devices[0])['type_key']);
        $this->assertSame([], $queries->children(Organization::where('slug', 'northstar-utilities')->firstOrFail(), $this->site->uuid));
    }

    public function test_no_hierarchy_table_has_a_place_for_a_protocol_or_a_node_address(): void
    {
        foreach (['entity_types', 'entities', 'entity_closure', 'entity_changes', 'entity_placements'] as $table) {
            foreach (Schema::getColumnListing($table) as $column) {
                $this->assertDoesNotMatchRegularExpression('/protocol|node|endpoint|opc|address_space|browse|source|connection|adapter/i', $column, "{$table}.{$column} (FR-025)");
            }
        }
    }
}
