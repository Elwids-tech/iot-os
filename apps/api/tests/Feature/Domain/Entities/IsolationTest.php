<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Shared\Models\Organization;

/** Spec 009 FR-020: another organization can neither read nor change the hierarchy. */
final class IsolationTest extends EntityTestCase
{
    public function test_another_organizations_types_and_entities_are_out_of_reach(): void
    {
        $this->preset('manufacturing');
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $area = EntityType::where('organization_id', $this->organization->id)->where('key', 'area')->sole();

        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $theirs = '/api/v1/organizations/'.$northstar->uuid;
        $this->actAs('northstar.admin@example.test');
        // Their own hierarchy works.
        $this->postJson($theirs.'/entities', ['type_key' => 'site', 'name' => 'North yard', 'timezone' => 'UTC'])->assertCreated();

        // Acme's entities and types through Northstar's routes: not found.
        foreach (['get' => '', 'patch' => '', 'delete' => ''] as $method => $suffix) {
            $this->json($method, $theirs.'/entities/'.$plant['uuid'].$suffix, ['name' => 'Taken'])->assertNotFound();
        }
        $this->getJson($theirs.'/entities/'.$plant['uuid'].'/move-impact')->assertNotFound();
        $this->postJson($theirs.'/entities/'.$plant['uuid'].'/move', ['parent_uuid' => null])->assertNotFound();
        $this->postJson($theirs.'/entities/'.$plant['uuid'].'/archive')->assertNotFound();
        $this->postJson($theirs.'/entities/'.$plant['uuid'].'/restore')->assertNotFound();
        $this->patchJson($theirs.'/entity-types/'.$area->uuid, ['name' => 'Taken'])->assertNotFound();
        $this->deleteJson($theirs.'/entity-types/'.$area->uuid)->assertNotFound();
        $this->getJson($theirs.'/entities?parent='.$plant['uuid'])->assertNotFound();

        // Nor can Acme's entity be a parent, and Acme's types are not Northstar's.
        $this->postJson($theirs.'/entities', ['type_key' => 'site', 'name' => 'Under', 'timezone' => 'UTC', 'parent_uuid' => $plant['uuid']])->assertUnprocessable()->assertJsonValidationErrors('parent_uuid');
        $this->postJson($theirs.'/entities', ['type_key' => 'area', 'name' => 'Area'])->assertUnprocessable()->assertJsonValidationErrors('type_key');
        $this->assertSame([], $this->getJson($theirs.'/entities/search?q=riverside')->assertOk()->json('data'));

        // And Acme's routes refuse a Northstar admin outright.
        $this->getJson($this->prefix.'/entities/'.$plant['uuid'])->assertForbidden();
        $this->assertSame('Riverside plant', Entity::where('uuid', $plant['uuid'])->value('name'));
    }

    public function test_an_entity_cannot_move_under_another_organizations_entity(): void
    {
        $plant = $this->entity('site', 'Riverside plant', null, ['timezone' => 'UTC']);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->actAs('shared.operator@example.test');
        $site = EntityType::query()->create(['organization_id' => $northstar->id, 'key' => 'site', 'name' => 'Site', 'top_level' => true, 'parent_type_keys' => ['site'], 'member_type_keys' => [], 'accepts_devices' => true, 'carries_timezone' => true, 'carries_location' => true, 'preset_keys' => []]);
        $yard = Entity::query()->create(['organization_id' => $northstar->id, 'entity_type_id' => $site->id, 'name' => 'Yard', 'path_name' => 'Yard', 'depth' => 0, 'path' => 'Yard', 'timezone' => 'UTC']);

        $this->postJson($this->prefix.'/entities/'.$plant['uuid'].'/move', ['parent_uuid' => $yard->uuid])->assertUnprocessable()->assertJsonValidationErrors('parent_uuid');
        $this->getJson($this->prefix.'/entities/'.$plant['uuid'].'/move-impact?parent='.$yard->uuid)->assertUnprocessable();
    }
}
