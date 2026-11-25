<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Audit\Models\Activity;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityChange;
use Illuminate\Support\Facades\DB;

/** Spec 009 US1: building the organization's tree (quickstart A). */
final class TreeTest extends EntityTestCase
{
    public function test_a_branch_is_built_under_the_rules_and_paths_follow_path_names(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'Europe/Berlin', 'latitude' => 52.5, 'longitude' => 13.4]);
        $packaging = $this->entity('area', 'Packaging', $plant['uuid']);
        $line = $this->entity('line', 'Line 2', $packaging['uuid']);
        $pump = $this->entity('asset', 'Filler pump P-201', $line['uuid'], ['attributes' => ['rated_kw' => 7.5, 'vendor' => 'Example']]);

        $this->assertSame('FillerPumpP201', $pump['path_name']);
        $this->assertSame('RiversidePlant/Packaging/Line2/FillerPumpP201', $pump['path']);
        $this->assertSame(3, $pump['depth']);
        $this->assertSame('Europe/Berlin', $pump['effective_timezone'], 'the nearest time zone above');
        $this->assertSame(['RiversidePlant', 'Packaging', 'Line2'], array_column($pump['ancestors'], 'path_name'));
        $this->assertSame(7.5, $pump['attributes']['rated_kw']);

        $this->getJson($this->prefix.'/entities')->assertOk()->assertJsonPath('data.0.path', 'RiversidePlant')->assertJsonPath('data.0.children_count', 1);
        $this->getJson($this->prefix.'/entities?parent='.$line['uuid'])->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Filler pump P-201');
        $this->getJson($this->prefix.'/entities/search?q=p201')->assertOk()->assertJsonPath('data.0.uuid', $pump['uuid']);
        $this->getJson($this->prefix.'/entities/search?q=line2/f')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.uuid', $pump['uuid']);
        $this->getJson($this->prefix.'/entities/path-name-suggestion?name=Eastgate%20SS')->assertOk()->assertJsonPath('data.path_name', 'EastgateSS');

        $this->assertSame(1, EntityChange::where('entity_id', Entity::where('uuid', $pump['uuid'])->value('id'))->where('kind', 'created')->count());
        $this->assertSame(4, Activity::where('event', 'entity.created')->count());
    }

    public function test_types_are_refused_where_the_rules_do_not_allow_them(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);

        $this->postJson($this->prefix.'/entities', ['type_key' => 'line', 'name' => 'Loose line'])
            ->assertUnprocessable()->assertJsonValidationErrors(['type_key' => 'Allowed: Area.']);
        $this->postJson($this->prefix.'/entities', ['type_key' => 'line', 'name' => 'Line', 'parent_uuid' => $plant['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['type_key' => 'cannot sit under Site']);
        $this->postJson($this->prefix.'/entities', ['type_key' => 'nope', 'name' => 'Nope'])->assertUnprocessable()->assertJsonValidationErrors('type_key');
        $this->postJson($this->prefix.'/entities', ['type_key' => 'site', 'name' => 'No zone'])
            ->assertUnprocessable()->assertJsonValidationErrors(['timezone' => 'Sites need a time zone.']);
        $this->postJson($this->prefix.'/entities', ['type_key' => 'area', 'name' => 'Zoned', 'parent_uuid' => $plant['uuid'], 'timezone' => 'UTC'])
            ->assertUnprocessable()->assertJsonValidationErrors('timezone');
        $this->postJson($this->prefix.'/entities', ['type_key' => 'area', 'name' => '★', 'parent_uuid' => $plant['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors('path_name');
        $this->entity('area', '★', $plant['uuid'], ['path_name' => 'Star']);
    }

    public function test_path_names_are_unique_among_active_siblings_ignoring_case(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $other = $this->entity('site', 'Hilltop plant', null, ['timezone' => 'UTC']);
        $first = $this->entity('area', 'Packaging', $plant['uuid']);
        $this->postJson($this->prefix.'/entities', ['type_key' => 'area', 'name' => 'packaging', 'parent_uuid' => $plant['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['path_name' => 'Packaging already uses the path name Packaging here.']);
        $this->entity('area', 'Packaging', $other['uuid']);

        // Archiving frees the name; restoring needs another.
        $this->postJson($this->prefix.'/entities/'.$first['uuid'].'/archive')->assertOk();
        $this->entity('area', 'Packaging', $plant['uuid']);
        $this->getJson($this->prefix.'/entities?parent='.$plant['uuid'].'&archived=only')->assertOk()->assertJsonCount(1, 'data');
        $this->postJson($this->prefix.'/entities/'.$first['uuid'].'/restore')->assertUnprocessable()->assertJsonValidationErrors('path_name');
        $this->postJson($this->prefix.'/entities/'.$first['uuid'].'/restore', ['path_name' => 'PackagingOld'])->assertOk()
            ->assertJsonPath('data.path', 'RiversidePlant/PackagingOld')->assertJsonPath('data.archived_at', null);
    }

    public function test_a_move_carries_the_branch_and_is_refused_into_itself(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $packaging = $this->entity('area', 'Packaging', $plant['uuid']);
        $assembly = $this->entity('area', 'Assembly', $plant['uuid']);
        $line = $this->entity('line', 'Line 2', $packaging['uuid']);
        $pump = $this->entity('asset', 'Pump', $line['uuid']);

        $this->getJson($this->prefix.'/entities/'.$line['uuid'].'/move-impact?parent='.$assembly['uuid'])->assertOk()->assertJsonPath('data.entities', 2);
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/move', ['parent_uuid' => $assembly['uuid']])->assertOk()
            ->assertJsonPath('data.path', 'RiversidePlant/Assembly/Line2');
        $this->getJson($this->prefix.'/entities/'.$pump['uuid'])->assertOk()->assertJsonPath('data.path', 'RiversidePlant/Assembly/Line2/Pump')
            ->assertJsonPath('data.ancestors.1.name', 'Assembly');
        $this->assertEquals(
            [Entity::where('uuid', $plant['uuid'])->value('id') => 3, Entity::where('uuid', $assembly['uuid'])->value('id') => 2],
            DB::table('entity_closure')->where('descendant_id', Entity::where('uuid', $pump['uuid'])->value('id'))->whereIn('ancestor_id', Entity::whereIn('uuid', [$plant['uuid'], $assembly['uuid'], $packaging['uuid']])->pluck('id'))->pluck('depth', 'ancestor_id')->all(),
            'the closure follows the move and forgets the old parent',
        );
        $moved = EntityChange::where('kind', 'moved')->sole();
        $this->assertSame(Entity::where('uuid', $packaging['uuid'])->value('id'), $moved->old_parent_id);
        $this->assertSame(1, Activity::where('event', 'entity.moved')->count());

        $this->postJson($this->prefix.'/entities/'.$packaging['uuid'].'/move', ['parent_uuid' => $packaging['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors('parent_uuid');
        $this->postJson($this->prefix.'/entities/'.$assembly['uuid'].'/move', ['parent_uuid' => $pump['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['parent_uuid' => 'descendants']);
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/move', ['parent_uuid' => $plant['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['parent_uuid' => 'Line cannot sit under Site']);

        // Moving to where it already is changes nothing.
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/move', ['parent_uuid' => $assembly['uuid']])->assertOk();
        $this->assertSame(1, Activity::where('event', 'entity.moved')->count());
    }

    public function test_renames_rewrite_the_branch_and_a_request_that_changes_nothing_records_nothing(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $area = $this->entity('area', 'Packaging', $plant['uuid']);
        $line = $this->entity('line', 'Line 2', $area['uuid']);

        $this->patchJson($this->prefix.'/entities/'.$area['uuid'], ['path_name' => 'Pack'])->assertOk()->assertJsonPath('data.path', 'RiversidePlant/Pack');
        $this->getJson($this->prefix.'/entities/'.$line['uuid'])->assertJsonPath('data.path', 'RiversidePlant/Pack/Line2');
        $this->assertSame(['Packaging', 'Pack'], [EntityChange::where('kind', 'renamed')->sole()->old_path_name, EntityChange::where('kind', 'renamed')->sole()->new_path_name]);

        $before = Activity::count();
        $this->patchJson($this->prefix.'/entities/'.$area['uuid'], ['name' => 'Packaging', 'path_name' => 'Pack'])->assertOk();
        $this->assertSame($before, Activity::count());
        $this->patchJson($this->prefix.'/entities/'.$area['uuid'], ['name' => 'Packaging hall'])->assertOk()->assertJsonPath('data.path', 'RiversidePlant/Pack');
        $this->assertSame($before + 1, Activity::count());
    }

    public function test_retyping_checks_the_parent_the_children_and_the_naming_rule(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $line = $this->entity('line', 'Line 2', $this->entity('area', 'Packaging', $plant['uuid'])['uuid']);
        $cell = $this->entity('cell', 'Cell 1', $line['uuid']);
        $this->entity('asset', 'Pump', $cell['uuid']);
        $asset = $this->entity('asset', 'Mixer', $line['uuid']);

        $this->patchJson($this->prefix.'/entities/'.$cell['uuid'], ['type_key' => 'asset'])
            ->assertUnprocessable()->assertJsonValidationErrors(['type_key' => 'Pump (Asset) cannot sit under Asset']);
        $this->patchJson($this->prefix.'/entities/'.$asset['uuid'], ['type_key' => 'cell'])->assertOk()->assertJsonPath('data.type.key', 'cell');
        $this->assertSame(1, EntityChange::where('kind', 'retyped')->count());
        $this->assertSame(1, Activity::where('event', 'entity.retyped')->count());
    }

    public function test_depth_is_limited(): void
    {
        $this->postJson($this->prefix.'/entity-types', ['key' => 'box', 'name' => 'Box', 'top_level' => true, 'parent_type_keys' => ['box']])->assertCreated();
        $parent = null;
        for ($level = 1; $level <= 12; $level++) {
            $parent = $this->entity('box', 'Box '.$level, $parent)['uuid'];
        }
        $this->postJson($this->prefix.'/entities', ['type_key' => 'box', 'name' => 'Too deep', 'parent_uuid' => $parent])
            ->assertUnprocessable()->assertJsonValidationErrors(['parent_uuid' => 'at most 12 levels']);

        $top = $this->entity('box', 'Other', null);
        $child = $this->entity('box', 'Child', $top['uuid']);
        $second = Entity::where('depth', 1)->where('name', 'Box 2')->value('uuid');
        $this->postJson($this->prefix.'/entities/'.$top['uuid'].'/move', ['parent_uuid' => Entity::where('name', 'Box 11')->value('uuid')])
            ->assertUnprocessable()->assertJsonValidationErrors(['parent_uuid' => 'at most 12 levels']);
        $this->postJson($this->prefix.'/entities/'.$top['uuid'].'/move', ['parent_uuid' => $second])->assertOk();
        $this->getJson($this->prefix.'/entities/'.$child['uuid'])->assertJsonPath('data.depth', 3);
    }

    public function test_archive_needs_an_empty_entity_and_delete_needs_one_that_never_held_anything(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $area = $this->entity('area', 'Packaging', $plant['uuid']);
        $line = $this->entity('line', 'Line 2', $area['uuid']);
        $spare = $this->entity('area', 'Spare', $plant['uuid']);

        $this->postJson($this->prefix.'/entities/'.$area['uuid'].'/archive')->assertUnprocessable()->assertJsonValidationErrors('entity');
        $this->deleteJson($this->prefix.'/entities/'.$area['uuid'])->assertUnprocessable()->assertJsonValidationErrors(['entity' => 'archive it instead']);
        $this->deleteJson($this->prefix.'/entities/'.$spare['uuid'])->assertNoContent();
        $this->assertSame(1, Activity::where('event', 'entity.deleted')->count());

        // A line that has been archived still counts as held: the area keeps its history.
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/archive')->assertOk();
        $this->deleteJson($this->prefix.'/entities/'.$area['uuid'])->assertUnprocessable();
        $this->postJson($this->prefix.'/entities/'.$area['uuid'].'/archive')->assertOk()->assertJsonPath('data.children_count', 0);
        $this->getJson($this->prefix.'/entities?parent='.$plant['uuid'])->assertOk()->assertJsonCount(0, 'data');
        $this->postJson($this->prefix.'/entities', ['type_key' => 'line', 'name' => 'Line 3', 'parent_uuid' => $area['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors('parent_uuid');
        $this->getJson($this->prefix.'/entities/search?q=pack')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/restore')->assertUnprocessable()->assertJsonValidationErrors(['path_name' => 'Restore Packaging first']);
    }

    public function test_the_organization_ceiling_is_kept(): void
    {
        config(['entities.max_per_organization' => 2]);
        $this->entity('site', 'One', null, ['timezone' => 'UTC']);
        $this->entity('site', 'Two', null, ['timezone' => 'UTC']);
        $this->postJson($this->prefix.'/entities', ['type_key' => 'site', 'name' => 'Three', 'timezone' => 'UTC'])
            ->assertUnprocessable()->assertJsonValidationErrors(['name' => 'limit of 2 entities']);
    }

    public function test_viewing_and_managing_need_their_permissions(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);

        $this->actAs('acme.member@example.test');
        $this->getJson($this->prefix.'/entities')->assertOk();
        $this->getJson($this->prefix.'/entities/'.$plant['uuid'])->assertOk();
        $this->postJson($this->prefix.'/entities', ['type_key' => 'site', 'name' => 'Mine', 'timezone' => 'UTC'])->assertForbidden();
        $this->postJson($this->prefix.'/entities/'.$plant['uuid'].'/archive')->assertForbidden();
        $this->postJson($this->prefix.'/entity-presets/buildings/apply')->assertForbidden();

        $this->actAs('northstar.admin@example.test');
        $this->getJson($this->prefix.'/entities')->assertForbidden();
    }
}
