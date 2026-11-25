<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;

/** Spec 009 FR-027, research R7: a move re-makes the device's place in the target's hierarchy. */
final class MoveIntoHierarchyTest extends MoveTestCase
{
    public function test_the_successor_is_placed_where_the_mover_chose_and_the_predecessor_keeps_its_last_place(): void
    {
        $x = $this->unsourced('Tracker X');
        [$zoneA, $siteB, $floorB] = $this->as($this->mover, function () use ($x): array {
            $this->postJson($this->in($this->a).'/entity-presets/buildings/apply')->assertOk();
            $siteA = $this->postJson($this->in($this->a).'/entities', ['type_key' => 'site', 'name' => 'Quay', 'timezone' => 'Europe/Berlin'])->assertCreated()->json('data');
            $building = $this->postJson($this->in($this->a).'/entities', ['type_key' => 'building', 'name' => 'Shed', 'parent_uuid' => $siteA['uuid']])->assertCreated()->json('data');
            $floor = $this->postJson($this->in($this->a).'/entities', ['type_key' => 'floor', 'name' => 'Ground', 'parent_uuid' => $building['uuid']])->assertCreated()->json('data');
            $zoneA = $this->postJson($this->in($this->a).'/entities', ['type_key' => 'zone', 'name' => 'Zone A', 'parent_uuid' => $floor['uuid']])->assertCreated()->json('data');
            $this->putJson($this->in($this->a).'/devices/'.$x->uuid.'/placement', ['entity_uuid' => $zoneA['uuid']])->assertOk();

            $this->postJson($this->in($this->b).'/entity-presets/buildings/apply')->assertOk();
            $siteB = $this->postJson($this->in($this->b).'/entities', ['type_key' => 'site', 'name' => 'Harbour', 'timezone' => 'America/Toronto'])->assertCreated()->json('data');
            $buildingB = $this->postJson($this->in($this->b).'/entities', ['type_key' => 'building', 'name' => 'Shop', 'parent_uuid' => $siteB['uuid']])->assertCreated()->json('data');
            $floorB = $this->postJson($this->in($this->b).'/entities', ['type_key' => 'floor', 'name' => 'First', 'parent_uuid' => $buildingB['uuid']])->assertCreated()->json('data');

            return [$zoneA, $siteB, $floorB];
        });

        $this->as($this->mover, function () use ($x, $zoneA, $siteB, $floorB): void {
            // A place of the source, or a site and a place together, is refused.
            $this->review($this->a, $this->b, [$x], ['devices' => [['uuid' => $x->uuid, 'entity_uuid' => $zoneA['uuid']]]])->assertUnprocessable()->assertJsonValidationErrors('devices.0.entity_uuid');
            $this->review($this->a, $this->b, [$x], ['devices' => [['uuid' => $x->uuid, 'entity_uuid' => $floorB['uuid'], 'site_uuid' => $siteB['uuid']]]])->assertUnprocessable()->assertJsonValidationErrors('devices.0.entity_uuid');
            $this->review($this->a, $this->b, [$x], ['devices' => [['uuid' => $x->uuid, 'entity_uuid' => $floorB['uuid']]]])->assertOk()
                ->assertJsonPath('devices.0.successor.site_uuid', $siteB['uuid']);

            $this->moved($this->a, $this->b, [$x], ['devices' => [['uuid' => $x->uuid, 'entity_uuid' => $floorB['uuid']]]]);
        });

        $successor = $this->successor($x);
        $this->assertSame(Entity::where('uuid', $floorB['uuid'])->value('id'), $successor->entity_id);
        $this->assertSame(Entity::where('uuid', $siteB['uuid'])->value('id'), $successor->site_id);
        $this->assertSame('America/Toronto', $successor->reportingTimezone());

        $x->refresh();
        $this->assertSame('archived', $x->lifecycle);
        $this->assertSame(Entity::where('uuid', $zoneA['uuid'])->value('id'), $x->entity_id, 'the predecessor keeps its last place');
        $this->assertSame('Europe/Berlin', $x->reportingTimezone());
        $ended = EntityPlacement::where('device_id', $x->id)->sole();
        $this->assertSame(EntityPlacement::MOVED_OUT, $ended->end_reason);
        $this->assertNotNull($ended->ended_at);
    }

    public function test_a_site_chosen_the_old_way_still_places_the_successor(): void
    {
        $x = $this->unsourced('Tracker X');
        $site = $this->as($this->mover, fn () => $this->postJson($this->in($this->b).'/sites', ['name' => 'Shop floor', 'timezone' => 'UTC'])->assertCreated()->json('data'));
        $this->as($this->mover, fn () => $this->moved($this->a, $this->b, [$x], ['devices' => [['uuid' => $x->uuid, 'site_uuid' => $site['uuid']]]]));

        $successor = $this->successor($x);
        $this->assertSame(Entity::where('uuid', $site['uuid'])->value('id'), $successor->site_id);
        $this->assertSame($successor->site_id, $successor->entity_id);
        $this->assertSame(1, EntityPlacement::where('device_id', $successor->id)->whereNull('ended_at')->count());
    }
}
