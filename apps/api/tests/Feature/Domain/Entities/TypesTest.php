<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Audit\Models\Activity;
use App\Domain\Entities\Models\EntityType;

/** Spec 009 US5: types, rules and presets. */
final class TypesTest extends EntityTestCase
{
    public function test_every_organization_has_a_site_type_whose_essentials_cannot_change(): void
    {
        $types = $this->getJson($this->prefix.'/entity-types')->assertOk()->json('data');
        $this->assertSame(['site'], array_column($types, 'key'));
        $site = $types[0];
        $this->assertTrue($site['top_level'] && $site['accepts_devices'] && $site['carries_timezone'] && $site['carries_location']);

        $this->patchJson($this->prefix.'/entity-types/'.$site['uuid'], ['carries_timezone' => false])->assertUnprocessable()->assertJsonValidationErrors('carries_timezone');
        $this->patchJson($this->prefix.'/entity-types/'.$site['uuid'], ['name' => 'Plant'])->assertOk()->assertJsonPath('data.name', 'Plant')->assertJsonPath('data.key', 'site');
        $this->deleteJson($this->prefix.'/entity-types/'.$site['uuid'])->assertUnprocessable()->assertJsonValidationErrors('type');
    }

    public function test_presets_merge_by_key_and_applying_again_changes_nothing(): void
    {
        $this->getJson($this->prefix.'/entity-presets')->assertOk()
            ->assertJsonPath('data.0.key', 'manufacturing')->assertJsonPath('data.0.types.0', ['key' => 'site', 'name' => 'Site', 'outcome' => 'present']);
        $this->preset('manufacturing')->assertJsonPath('data.added', ['area', 'line', 'cell', 'asset'])->assertJsonPath('data.merged', []);
        $this->preset('buildings')->assertJsonPath('data.added', ['building', 'floor', 'zone', 'room']);
        $site = EntityType::where('organization_id', $this->organization->id)->where('key', 'site')->sole();
        $this->assertSame(['manufacturing', 'buildings'], $site->preset_keys);
        $this->assertSame(['site'], EntityType::where('organization_id', $this->organization->id)->where('key', 'building')->sole()->parent_type_keys);

        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $this->entity('area', 'Packaging', $plant['uuid']);
        $this->entity('building', 'Office', $plant['uuid']);

        $applied = Activity::where('event', 'entity_type.preset_applied')->count();
        $this->preset('buildings')->assertJsonPath('data.added', [])->assertJsonPath('data.merged', []);
        $this->assertSame($applied, Activity::where('event', 'entity_type.preset_applied')->count());
        $this->getJson($this->prefix.'/entity-presets')->assertOk()->assertJsonPath('data.1.types.1.outcome', 'present');

        $this->preset('power_distribution')->assertJsonPath('data.added.0', 'region');
        $division = EntityType::where('organization_id', $this->organization->id)->where('key', 'division')->sole();
        $this->assertSame(['substation', 'feeder', 'distribution_transformer'], $division->member_type_keys);
        $this->postJson($this->prefix.'/entity-presets/unknown/apply')->assertNotFound();
    }

    public function test_a_preset_merges_parents_into_a_type_people_made_themselves(): void
    {
        $this->postJson($this->prefix.'/entity-types', ['key' => 'area', 'name' => 'Area', 'parent_type_keys' => [], 'accepts_devices' => false])->assertCreated();
        $this->preset('manufacturing')->assertJsonPath('data.merged', ['area']);
        $area = EntityType::where('organization_id', $this->organization->id)->where('key', 'area')->sole();
        $this->assertSame(['site'], $area->parent_type_keys);
        $this->assertFalse($area->accepts_devices, 'only parents and members merge');
    }

    public function test_naming_rules_are_held_and_a_rule_change_moves_nothing(): void
    {
        $this->preset('power_distribution');
        $feeder = EntityType::where('organization_id', $this->organization->id)->where('key', 'feeder')->sole();
        $north = $this->entity('region', 'North', null);
        $substation = $this->entity('substation', 'Eastgate SS', $north['uuid']);
        $old = $this->entity('feeder', 'Old feeder', $substation['uuid'], ['path_name' => 'old-feeder']);

        $this->patchJson($this->prefix.'/entity-types/'.$feeder->uuid, ['naming_template' => 'Feeder<num>', 'naming_example' => 'Feeder12'])
            ->assertUnprocessable()->assertJsonValidationErrors('naming_template');
        $this->patchJson($this->prefix.'/entity-types/'.$feeder->uuid, ['naming_template' => 'Feeder<number>', 'naming_example' => 'F12'])
            ->assertUnprocessable()->assertJsonValidationErrors('naming_example');
        $this->patchJson($this->prefix.'/entity-types/'.$feeder->uuid, ['naming_template' => 'Feeder<number>', 'naming_example' => 'Feeder12', 'naming_description' => 'Feeder and its number'])
            ->assertOk()->assertJsonPath('data.naming.template', 'Feeder<number>');

        $this->postJson($this->prefix.'/entities', ['type_key' => 'feeder', 'name' => 'Feeder 12', 'path_name' => 'feeder-12', 'parent_uuid' => $substation['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['path_name' => 'Feeder and its number. For example Feeder12.']);
        $this->assertSame('Feeder12', $this->entity('feeder', 'Feeder 12', $substation['uuid'])['path_name']);

        // The older feeder stays where it is, listed as outside the current rules.
        $this->getJson($this->prefix.'/entities/'.$old['uuid'])->assertOk()->assertJsonPath('data.path', 'North/EastgateSS/old-feeder')->assertJsonPath('data.outside_rules', ['naming']);
        $this->patchJson($this->prefix.'/entity-types/'.$feeder->uuid, ['parent_type_keys' => ['region']])->assertOk();
        $this->getJson($this->prefix.'/entities/'.$old['uuid'])->assertOk()->assertJsonPath('data.outside_rules', ['parent_type', 'naming']);
        $this->patchJson($this->prefix.'/entities/'.$old['uuid'], ['name' => 'Old feeder 1'])->assertOk();
    }

    public function test_a_type_in_use_or_named_by_another_cannot_be_deleted(): void
    {
        $this->preset('manufacturing');
        $cell = EntityType::where('organization_id', $this->organization->id)->where('key', 'cell')->sole();
        $this->deleteJson($this->prefix.'/entity-types/'.$cell->uuid)->assertUnprocessable()->assertJsonValidationErrors(['type' => 'named in the rules of Asset']);

        $custom = $this->postJson($this->prefix.'/entity-types', ['key' => 'kiosk', 'name' => 'Kiosk', 'parent_type_keys' => ['site'], 'accepts_devices' => true])->assertCreated()->json('data');
        $this->postJson($this->prefix.'/entity-types', ['key' => 'kiosk', 'name' => 'Other'])->assertUnprocessable()->assertJsonValidationErrors('key');
        $this->postJson($this->prefix.'/entity-types', ['key' => 'booth', 'name' => 'KIOSK'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson($this->prefix.'/entity-types', ['key' => 'Bad Key', 'name' => 'Bad'])->assertUnprocessable()->assertJsonValidationErrors('key');
        $this->postJson($this->prefix.'/entity-types', ['key' => 'orphan', 'name' => 'Orphan', 'parent_type_keys' => ['nowhere']])->assertUnprocessable()->assertJsonValidationErrors('parent_type_keys');

        $kiosk = $this->entity('kiosk', 'Front kiosk', $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC'])['uuid']);
        $this->deleteJson($this->prefix.'/entity-types/'.$custom['uuid'])->assertUnprocessable()->assertJsonValidationErrors(['type' => 'in use']);
        $this->patchJson($this->prefix.'/entity-types/'.$custom['uuid'], ['name' => 'Info kiosk'])->assertOk()->assertJsonPath('data.entities_count', 1);
        $this->deleteJson($this->prefix.'/entities/'.$kiosk['uuid'])->assertNoContent();
        $this->deleteJson($this->prefix.'/entity-types/'.$custom['uuid'])->assertNoContent();
        $this->assertSame(['entity_type.created', 'entity_type.updated', 'entity_type.deleted'], Activity::where('event', 'like', 'entity_type.%')->where('event', '!=', 'entity_type.preset_applied')->orderBy('id')->pluck('event')->all());
    }

    public function test_types_need_their_own_permission(): void
    {
        $this->actAs('acme.member@example.test');
        $this->getJson($this->prefix.'/entity-types')->assertOk();
        $this->postJson($this->prefix.'/entity-types', ['key' => 'kiosk', 'name' => 'Kiosk'])->assertForbidden();
    }
}
