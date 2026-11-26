<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Entities;

use App\Domain\Audit\Models\Activity;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Entities\Models\Entity;
use App\Domain\Entities\Models\EntityPlacement;
use App\Domain\Entities\Services\EntityPresets;
use App\Domain\Entities\Services\EntityTree;
use App\Domain\Entities\Services\Placements;
use App\Domain\Integrations\Services\ApplicationGrant;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Spec 009 US2 (devices), US3 (sites are entities), FR-009, FR-013 to FR-015, R5 and R8. */
final class PlacementTest extends EntityTestCase
{
    private function device(string $code): Device
    {
        $uuid = $this->postJson($this->prefix.'/devices', ['name' => ucfirst($code), 'code' => $code])->assertCreated()->json('data.uuid');

        return Device::where('uuid', $uuid)->firstOrFail();
    }

    /** @return array{site: array<string, mixed>, area: array<string, mixed>, line: array<string, mixed>} */
    private function plant(string $name = 'Riverside plant', string $zone = 'Europe/Berlin'): array
    {
        $this->preset('manufacturing');
        $site = $this->postJson($this->prefix.'/sites', ['name' => $name, 'timezone' => $zone])->assertCreated()->json('data');
        $area = $this->entity('area', 'Packaging', $site['uuid']);

        return ['site' => $site, 'area' => $area, 'line' => $this->entity('line', 'Line 2', $area['uuid'])];
    }

    public function test_a_device_is_placed_moved_and_unplaced_with_its_history_kept(): void
    {
        ['site' => $site, 'line' => $line, 'area' => $area] = $this->plant();
        $pump = $this->device('pump-1');

        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $line['uuid']])->assertOk()
            ->assertJsonPath('data.entity.path', 'RiversidePlant/Packaging/Line2')->assertJsonPath('data.ended_at', null);
        $this->getJson($this->prefix.'/devices/'.$pump->uuid)->assertOk()
            ->assertJsonPath('data.entity.path', 'RiversidePlant/Packaging/Line2')
            ->assertJsonPath('data.site.uuid', $site['uuid'])->assertJsonPath('data.reporting_timezone', 'Europe/Berlin');
        // The same place again changes nothing.
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $line['uuid']])->assertOk();
        $this->assertSame(1, Activity::where('event', 'device.placed')->count());

        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $area['uuid']])->assertOk();
        $this->getJson($this->prefix.'/entities/'.$line['uuid'].'/devices')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->prefix.'/entities/'.$site['uuid'].'/devices?branch=1')->assertOk()->assertJsonPath('data.0.uuid', $pump->uuid)->assertJsonPath('data.0.entity.name', 'Packaging');
        $this->deleteJson($this->prefix.'/devices/'.$pump->uuid.'/placement')->assertNoContent();

        $history = $this->getJson($this->prefix.'/devices/'.$pump->uuid.'/placements')->assertOk()->json('data');
        $this->assertSame([['Packaging', 'unplaced'], ['Line 2', 'moved']], array_map(fn ($p) => [$p['entity']['name'], $p['end_reason']], $history));
        $this->assertNull($pump->fresh()->site_id);
        $this->assertSame('UTC', $pump->fresh()->reportingTimezone());
        $this->assertSame(['device.placed', 'device.placed', 'device.unplaced'], Activity::where('event', 'like', 'device.%placed')->orderBy('id')->pluck('event')->all());
    }

    public function test_placements_are_refused_where_the_rules_or_the_organization_do_not_allow_them(): void
    {
        $this->preset('power_distribution');
        $region = $this->entity('region', 'North', null);
        $pump = $this->device('pump-1');
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $region['uuid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['entity_uuid' => 'Devices cannot be placed on a Region.']);

        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $theirs = $this->withNorthstarSite($northstar);
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $theirs->uuid])->assertUnprocessable()->assertJsonValidationErrors('entity_uuid');
        $this->patchJson($this->prefix.'/devices/'.$pump->uuid, ['name' => 'Pump', 'code' => 'pump-1', 'draft_revision' => $pump->fresh()->draft_revision, 'entity_uuid' => $theirs->uuid])
            ->assertUnprocessable()->assertJsonValidationErrors('entity_uuid');
        $this->actAs('northstar.admin@example.test');
        $this->putJson('/api/v1/organizations/'.$northstar->uuid.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $theirs->uuid])->assertNotFound();
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/devices/'.$pump->uuid.'/placements')->assertNotFound();

        // Viewers cannot place.
        $this->actAs('acme.member@example.test');
        $site = $this->getJson($this->prefix.'/entities')->json('data.0.uuid');
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $site])->assertForbidden();
    }

    public function test_the_device_form_places_through_a_site_or_an_entity(): void
    {
        ['site' => $site, 'line' => $line] = $this->plant();
        $pump = $this->device('pump-1');
        $this->patchJson($this->prefix.'/devices/'.$pump->uuid, ['name' => 'Pump', 'code' => 'pump-1', 'draft_revision' => $pump->draft_revision, 'site_uuid' => $site['uuid']])
            ->assertOk()->assertJsonPath('data.site.uuid', $site['uuid'])->assertJsonPath('data.entity.uuid', $site['uuid']);
        $this->patchJson($this->prefix.'/devices/'.$pump->uuid, ['name' => 'Pump', 'code' => 'pump-1', 'draft_revision' => $pump->fresh()->draft_revision, 'entity_uuid' => $line['uuid']])
            ->assertOk()->assertJsonPath('data.site.uuid', $site['uuid'])->assertJsonPath('data.entity.path', 'RiversidePlant/Packaging/Line2');
        $this->patchJson($this->prefix.'/devices/'.$pump->uuid, ['name' => 'Pump', 'code' => 'pump-1', 'draft_revision' => $pump->fresh()->draft_revision, 'entity_uuid' => $line['uuid'], 'site_uuid' => $site['uuid']])
            ->assertUnprocessable();
        $this->patchJson($this->prefix.'/devices/'.$pump->uuid, ['name' => 'Pump', 'code' => 'pump-1', 'draft_revision' => $pump->fresh()->draft_revision, 'site_uuid' => null])
            ->assertOk()->assertJsonPath('data.site', null)->assertJsonPath('data.entity', null);
        $this->assertSame(0, Activity::where('event', 'device.placed')->count(), 'the device edit records the change once, as device.updated');

        $created = $this->postJson($this->prefix.'/devices', ['name' => 'Meter', 'code' => 'meter-1', 'entity_uuid' => $line['uuid']])->assertCreated();
        $created->assertJsonPath('data.entity.uuid', $line['uuid'])->assertJsonPath('data.site.uuid', $site['uuid']);
    }

    public function test_a_site_scope_and_a_site_filter_follow_devices_placed_deep_in_the_site(): void
    {
        ['site' => $site, 'line' => $line] = $this->plant();
        $deep = $this->device('deep-1');
        $outside = $this->device('outside-1');
        $this->putJson($this->prefix.'/devices/'.$deep->uuid.'/placement', ['entity_uuid' => $line['uuid']])->assertOk();

        $grant = fn () => (new ApplicationGrant($this->organization->id, [], [$site['uuid']]))->resolveUuids();
        $this->assertSame([$deep->uuid], $grant());
        $this->assertTrue((new ApplicationGrant($this->organization->id, [], [$site['uuid']]))->covers($deep->fresh()));
        $this->assertFalse((new ApplicationGrant($this->organization->id, [], [$site['uuid']]))->covers($outside->fresh()));
        $this->assertSame([$deep->uuid], array_column($this->getJson($this->prefix.'/devices?site_uuid='.$site['uuid'])->assertOk()->json('data'), 'uuid'));
        $this->getJson($this->prefix.'/sites')->assertOk()->assertJsonPath('data.0.devices_count', 1);

        // A site nested under the site is still in the outer site's scope.
        $inner = $this->postJson($this->prefix.'/entity-types/'.$this->siteType()['uuid'], [])->getStatusCode();
        $this->assertSame(405, $inner, 'types are changed with PATCH');
        $this->patchJson($this->prefix.'/entity-types/'.$this->siteType()['uuid'], ['parent_type_keys' => ['site']])->assertOk();
        $nested = $this->entity('site', 'Annex', $site['uuid'], ['timezone' => 'Asia/Tokyo']);
        $annexed = $this->device('annexed-1');
        $this->putJson($this->prefix.'/devices/'.$annexed->uuid.'/placement', ['entity_uuid' => $nested['uuid']])->assertOk();
        $this->assertSame(Entity::where('uuid', $nested['uuid'])->value('id'), $annexed->fresh()->site_id);
        $this->assertEqualsCanonicalizing([$deep->uuid, $annexed->uuid], $grant());
        $this->assertSame('Asia/Tokyo', $annexed->fresh()->reportingTimezone());
    }

    public function test_moving_a_branch_out_of_a_site_moves_its_devices_and_the_impact_says_so_first(): void
    {
        ['site' => $site, 'area' => $area, 'line' => $line] = $this->plant();
        $other = $this->postJson($this->prefix.'/sites', ['name' => 'Hilltop', 'timezone' => 'America/Toronto'])->assertCreated()->json('data');
        $otherArea = $this->entity('area', 'Assembly', $other['uuid']);
        $pump = $this->device('pump-1');
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $line['uuid']])->assertOk();
        DB::table('integration_applications')->insert(['uuid' => (string) Str::uuid(), 'organization_id' => $this->organization->id, 'name' => 'Plant viewer',
            'abilities' => json_encode(['devices:read']), 'entity_uuids' => json_encode([$site['uuid']]), 'device_uuids' => json_encode([]), 'created_at' => now(), 'updated_at' => now()]);

        $this->getJson($this->prefix.'/entities/'.$line['uuid'].'/move-impact?parent='.$otherArea['uuid'])->assertOk()
            ->assertJsonPath('data.entities', 1)->assertJsonPath('data.devices', 1)
            ->assertJsonPath('data.devices_changing_site', 1)->assertJsonPath('data.devices_changing_timezone', 1)
            ->assertJsonPath('data.applications.0.name', 'Plant viewer')->assertJsonPath('data.applications.0.loses', 1);
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/move', ['parent_uuid' => $otherArea['uuid']])->assertOk();

        $pump->refresh();
        $this->assertSame(Entity::where('uuid', $other['uuid'])->value('id'), $pump->site_id);
        $this->assertSame('America/Toronto', $pump->reportingTimezone());
        $this->assertSame([], (new ApplicationGrant($this->organization->id, [], [$site['uuid']]))->resolveUuids());
        $this->assertSame(Entity::where('uuid', $line['uuid'])->value('id'), $pump->entity_id, 'the device stays where it was placed');
        $this->getJson($this->prefix.'/entities/'.$area['uuid'].'/move-impact')->assertOk()->assertJsonPath('data.applications', []);
    }

    public function test_an_archived_device_keeps_its_last_place_and_an_entity_with_devices_cannot_be_archived_or_deleted(): void
    {
        ['site' => $site, 'line' => $line] = $this->plant();
        $pump = $this->device('pump-1');
        $this->putJson($this->prefix.'/devices/'.$pump->uuid.'/placement', ['entity_uuid' => $line['uuid']])->assertOk();
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/archive')->assertUnprocessable()->assertJsonValidationErrors(['entity' => 'unplace the devices']);

        $this->postJson($this->prefix.'/devices/'.$pump->uuid.'/archive', ['draft_revision' => $pump->fresh()->draft_revision])->assertOk();
        $pump->refresh();
        $this->assertSame('archived', $pump->lifecycle);
        $this->assertSame(Entity::where('uuid', $line['uuid'])->value('id'), $pump->entity_id);
        $this->assertSame('Europe/Berlin', $pump->reportingTimezone());
        $this->assertSame(EntityPlacement::DEVICE_ARCHIVED, EntityPlacement::where('device_id', $pump->id)->sole()->end_reason);
        $this->assertSame([$pump->uuid], (new ApplicationGrant($this->organization->id, [], [$site['uuid']]))->resolveUuids(), 'an application following the site still reads its history');

        $this->deleteJson($this->prefix.'/entities/'.$line['uuid'])->assertUnprocessable()->assertJsonValidationErrors(['entity' => 'entities or devices']);
        $this->postJson($this->prefix.'/entities/'.$line['uuid'].'/archive')->assertOk();
    }

    public function test_deleting_a_site_unplaces_its_devices_and_is_refused_while_entities_sit_under_it(): void
    {
        ['site' => $site, 'area' => $area, 'line' => $line] = $this->plant();
        $pump = $this->device('pump-1');
        $this->patchJson($this->prefix.'/devices/'.$pump->uuid, ['name' => 'Pump', 'code' => 'pump-1', 'draft_revision' => $pump->draft_revision, 'site_uuid' => $site['uuid']])->assertOk();
        $this->deleteJson($this->prefix.'/sites/'.$site['uuid'])->assertUnprocessable()->assertJsonValidationErrors('site');
        $this->deleteJson($this->prefix.'/entities/'.$line['uuid'])->assertNoContent();
        $this->deleteJson($this->prefix.'/entities/'.$area['uuid'])->assertNoContent();

        $this->deleteJson($this->prefix.'/sites/'.$site['uuid'])->assertNoContent();
        $this->assertNull($pump->fresh()->site_id);
        $this->assertNull($pump->fresh()->entity_id);
        $this->assertSame(EntityPlacement::ENTITY_ARCHIVED, EntityPlacement::where('device_id', $pump->id)->sole()->end_reason);
        $this->getJson($this->prefix.'/sites')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->prefix.'/entities?archived=only')->assertOk()->assertJsonPath('data.0.uuid', $site['uuid']);
        $this->assertSame(1, Activity::where('event', 'site.deleted')->count());
        $this->assertSame(0, Activity::where('event', 'entity.archived')->count(), 'one entry for the request, in the words of the sites API');
        // The name is free again.
        $this->postJson($this->prefix.'/sites', ['name' => 'Riverside plant', 'timezone' => 'UTC'])->assertCreated();
    }

    public function test_an_organization_with_a_tree_is_deleted_whole(): void
    {
        // Entities, their types and parents go in the statement that removes the organization.
        $organization = Organization::factory()->create();
        $actor = User::where('email', 'shared.operator@example.test')->firstOrFail();
        app(EntityPresets::class)->apply($organization, 'buildings', $actor);
        $tree = app(EntityTree::class);
        $site = $tree->create($organization, ['type_key' => 'site', 'name' => 'Campus', 'timezone' => 'UTC'], $actor);
        $building = $tree->create($organization, ['type_key' => 'building', 'name' => 'North hall', 'parent_uuid' => $site->uuid], $actor);
        $tree->create($organization, ['type_key' => 'floor', 'name' => 'Floor 1', 'parent_uuid' => $building->uuid], $actor);
        $device = Device::create(['organization_id' => $organization->id, 'code' => 'meter', 'name' => 'Meter']);
        app(Placements::class)->place($device, $building, $actor);
        $device->delete();
        // The deletion service keeps the activity log apart; here only the cascade is under test.
        DB::table('activity_log')->where('organization_id', $organization->id)->delete();

        DB::table('organizations')->where('id', $organization->id)->delete();

        foreach (['entity_types', 'entities', 'entity_placements', 'entity_changes'] as $table) {
            $this->assertSame(0, DB::table($table)->where('organization_id', $organization->id)->count(), $table);
        }
    }

    /** @return array<string, mixed> */
    private function siteType(): array
    {
        return collect($this->getJson($this->prefix.'/entity-types')->json('data'))->firstWhere('key', 'site');
    }

    private function withNorthstarSite(Organization $northstar): Site
    {
        return Site::create(['organization_id' => $northstar->id, 'name' => 'Yard', 'timezone' => 'UTC']);
    }
}
