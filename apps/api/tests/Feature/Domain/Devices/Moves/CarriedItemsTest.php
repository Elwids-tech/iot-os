<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Administration\Services\OrganizationRoleManager;
use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\WorkflowRewrite;
use App\Domain\Dashboards\Models\Dashboard;
use App\Domain\Dashboards\Services\DashboardRewrite;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Dashboards and automations come along with a move (spec 031 US2, the Independent Test):
 * D1 and W1 use only X, D2 and W2 use X and Y, and X moves to B with the preselected
 * choices. Choices the mover may not make aren't offered, archives are confirmed on their
 * own, and no dashboard or automation ends up using devices of two organizations.
 */
final class CarriedItemsTest extends MoveTestCase
{
    protected function runtimeAnswer(string $path, array $query): ?array
    {
        return str_ends_with($path, '/dag/node-types') ? [['type' => 'compare.v1', 'label' => 'Compare']] : null;
    }

    public function test_the_preselected_choices_move_copy_and_keep_and_nothing_crosses(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        $d1 = $this->dashboard($this->a, 'Shop', [$x]);
        $d2 = $this->dashboard($this->a, 'Fleet', [$x, $y]);
        $w1 = $this->automation($this->a, 'Shop low flow', [$x], recipients: [$this->mover->id, $this->aOnly->id]);
        $w2 = $this->automation($this->a, 'Fleet low flow', [$x, $y]);
        $this->automationsOn($this->b);

        $review = $this->review($this->a, $this->b, [$x])->assertOk()->json();
        $this->assertSame(['Fleet', 'Shop', 'Fleet low flow', 'Shop low flow'], array_column($review['items'], 'name'));
        $items = collect($review['items'])->keyBy('name');
        $this->assertSame([false, ['copy', 'keep'], 'copy'], [$items['Fleet']['uses_only_moving'], $items['Fleet']['actions'], $items['Fleet']['action']]);
        $this->assertSame(['Tracker Y flow (Tracker Y)'], $items['Fleet']['omitted']['panels']);
        $this->assertSame([true, ['move', 'keep', 'archive'], 'move'], [$items['Shop']['uses_only_moving'], $items['Shop']['actions'], $items['Shop']['action']]);
        $this->assertSame([['keep', 'archive'], 'keep'], [$items['Fleet low flow']['actions'], $items['Fleet low flow']['action']]);
        $this->assertSame(['count' => 1, 'can_add' => true, 'device_uuids' => [$y->uuid]], $items['Fleet low flow']['other_devices']);
        $this->assertSame('Stays in Integrator and is turned off until Tracker X is removed from it.', $items['Fleet low flow']['outcome']);
        $this->assertSame([['move', 'keep', 'archive'], 'move', true], [$items['Shop low flow']['actions'], $items['Shop low flow']['action'], $items['Shop low flow']['arrives_running']]);
        $this->assertSame(['A Only'], $items['Shop low flow']['omitted']['recipients']);
        $this->assertSame([], $review['archives']);
        $this->assertContains('1 device, 1 dashboard and 1 automation move to Harbour Shop.', $review['summary']);
        $this->assertContains('1 dashboard is copied to Harbour Shop with only the moving devices’ panels.', $review['summary']);
        $this->assertContains('1 automation stays in Integrator and can’t run until the moved devices are removed from it.', $review['summary']);

        $move = $this->moved($this->a, $this->b, [$x]);
        $inB = $this->successor($x);
        $this->applied($inB);

        // D1 moved to B, onto B's X and the copied profile's parameter, and saves there.
        $shop = Dashboard::where('uuid', $d1['uuid'])->firstOrFail();
        $this->assertSame($this->b->id, $shop->organization_id);
        $this->assertSame([$inB->uuid, $this->flowParameter($inB)['uuid']], [$shop->widgets[0]['config']['sources'][0]['device_uuid'], $shop->widgets[0]['config']['sources'][0]['parameter_uuid']]);
        $this->getJson($this->in($this->a).'/dashboards/'.$d1['uuid'])->assertNotFound();
        $saved = $this->getJson($this->in($this->b).'/dashboards/'.$d1['uuid'])->assertOk()->json('data');
        $this->putJson($this->in($this->b).'/dashboards/'.$d1['uuid'], ['name' => 'Shop', 'widgets' => $saved['widgets'], 'layouts' => $saved['layouts'], 'defaults' => $saved['defaults'], 'revision' => $saved['revision']])->assertOk();

        // B has a copy of D2 with X's panel only, owned by the mover and shared with no one.
        $copy = Dashboard::where('organization_id', $this->b->id)->where('name', 'Fleet')->firstOrFail();
        $this->assertSame([[$inB->uuid], 'restricted', $this->mover->id, 0], [DashboardRewrite::devices($copy->widgets), $copy->access, $copy->created_by, $copy->shares()->count()]);
        $this->assertSame(['Tracker X flow'], array_column($copy->widgets, 'title'));

        // A's D2 is unchanged, marks X as moved and saves as it is.
        $fleet = $this->getJson($this->in($this->a).'/dashboards/'.$d2['uuid'])->assertOk()->json('data');
        $this->assertSame([$x->uuid, $y->uuid], DashboardRewrite::devices($fleet['widgets']));
        $this->assertSame([['device_uuid' => $x->uuid, 'name' => 'Tracker X', 'organization_name' => 'Harbour Shop']], array_map(fn (array $moved): array => array_diff_key($moved, ['cutover_at' => 0]), $fleet['moved_devices']));
        $this->putJson($this->in($this->a).'/dashboards/'.$d2['uuid'], ['name' => 'Fleet', 'widgets' => $fleet['widgets'], 'layouts' => $fleet['layouts'], 'defaults' => $fleet['defaults'], 'revision' => $fleet['revision']])->assertOk();

        // W1 is recreated in B on B's X, keeps its recipient who is a member there, and starts once X is active.
        $moved = Workflow::where('organization_id', $this->b->id)->where('name', 'Shop low flow')->firstOrFail();
        $this->assertSame([[$inB->uuid], $this->b->uuid, [$this->mover->id]], [WorkflowRewrite::devices($moved->workflow), $moved->workflow['organization_uuid'], $moved->notification_settings['recipient_ids']]);
        $this->assertNotNull($moved->desired_deployment_uuid);
        $this->deployed($moved);
        $this->assertSame('applied', $moved->fresh()->deployment_status);
        // A's W1 is turned off and archived as moved, with its run history.
        $w1->refresh();
        $this->assertSame([$this->a->id, $move['uuid']], [$w1->organization_id, DeviceMove::find($w1->archived_by_move_id)?->uuid]);
        $applied = $w1->applied_deployment_uuid;
        $this->deployed($w1);
        $this->assertSame(['inactive', Deployment::STOPPED_MOVED], [$w1->fresh()->deployment_status, Deployment::where('uuid', $applied)->value('stopped_reason')]);
        $this->assertSame('Harbour Shop', $this->getJson($this->in($this->a).'/workflows/dag?archived=only')->assertOk()->json('data.0.moved_to'));

        // W2 stays in A, suspended naming X, and can't be turned on until X is removed.
        $this->deployed($w2);
        $kept = $this->getJson($this->in($this->a).'/workflows/'.$w2->uuid)->assertOk()->json('data');
        $this->assertSame('suspended', $kept['deployment_status']);
        $this->assertSame(['Tracker X'], array_column($kept['moved_devices'], 'name'));
        $this->postJson($this->in($this->a).'/workflows/'.$w2->uuid.'/deployments', ['operation_uuid' => fake()->uuid(), 'target_state' => 'active', 'draft_revision' => $kept['draft_revision'], 'expected_generation' => $kept['deployment_generation']])
            ->assertConflict()->assertJsonPath('message', 'Tracker X moved to Harbour Shop. Remove it from this automation before turning it on.');
        $this->assertStringContainsString('Tracker X moved to Harbour Shop', $this->getJson($this->in($this->a).'/workflows/dag')->assertOk()->json('data.0.last_issue.message'));

        // Done lists what landed where; members of one side see only their own side's links.
        $done = $this->getJson($this->in($this->b).'/device-moves/'.$move['uuid'])->assertOk()->json('data.items');
        $this->assertSame(['copy', 'move', 'keep', 'move'], array_column($done, 'action'));
        $this->assertSame([$copy->uuid, $d1['uuid'], null, $moved->uuid], array_column($done, 'target_uuid'));
        $this->assertSame([$d2['uuid'], null, $w2->uuid, $w1->uuid], array_column($done, 'source_uuid'));
        $this->assertSame([], $this->getJson($this->in($this->b).'/device-moves/'.$move['uuid'])->json('data.needs_attention'));
        $this->assertNoDashboardOrAutomationCrosses();
    }

    public function test_an_archive_is_confirmed_on_its_own(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $d1 = $this->dashboard($this->a, 'Shop', [$x]);
        $w1 = $this->automation($this->a, 'Shop low flow', [$x]);
        $choices = ['items' => [['kind' => 'dashboard', 'uuid' => $d1['uuid'], 'action' => 'archive'], ['kind' => 'automation', 'uuid' => $w1->uuid, 'action' => 'archive']]];

        $review = $this->review($this->a, $this->b, [$x], $choices)->assertOk()->json();
        $this->assertSame(['Shop', 'Shop low flow'], array_column($review['archives'], 'name'));
        $this->assertContains('1 dashboard and 1 automation are archived in Integrator.', $review['summary']);
        $this->confirm($this->a, $this->b, [$x], $choices)->assertUnprocessable()->assertJsonValidationErrors(['confirmed_archives' => 'Confirm archiving Shop, Shop low flow on its own.']);
        $this->confirm($this->a, $this->b, [$x], [...$choices, 'confirmed_archives' => [['kind' => 'dashboard', 'uuid' => $d1['uuid']]]])->assertUnprocessable();
        $move = $this->confirm($this->a, $this->b, [$x], [...$choices, 'confirmed_archives' => array_map(fn (array $item): array => ['kind' => $item['kind'], 'uuid' => $item['uuid']], $choices['items'])])->assertAccepted()->json('data');
        $this->answerStops();

        $id = DeviceMove::where('uuid', $move['uuid'])->value('id');
        $shop = Dashboard::where('uuid', $d1['uuid'])->firstOrFail();
        $this->assertSame([$this->a->id, $id, true], [$shop->organization_id, $shop->archived_by_move_id, $shop->isArchived()]);
        $this->assertSame([$d1['uuid']], array_column($this->getJson($this->in($this->a).'/dashboards?archived=only')->assertOk()->json('data'), 'uuid'));
        $this->deployed($w1);
        $this->assertSame(['inactive', $id], [$w1->fresh()->deployment_status, $w1->fresh()->archived_by_move_id]);
        $this->assertSame(0, Dashboard::where('organization_id', $this->b->id)->count() + Workflow::where('organization_id', $this->b->id)->count());
    }

    public function test_choices_the_mover_may_not_make_are_not_offered(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        $d1 = $this->dashboard($this->a, 'Shop', [$x]);
        $this->dashboard($this->a, 'Fleet', [$x, $y]);
        $this->automation($this->a, 'Shop low flow', [$x]);
        $roles = app(OrganizationRoleManager::class);

        // In B the mover may move devices and nothing more.
        $roles->syncMemberRoles($this->b, $this->mover, [$roles->create($this->b, $this->mover, 'Device mover', ['Device.view', 'Device.move'])->id]);
        $items = collect($this->review($this->a, $this->b, [$x], ['items' => [['kind' => 'dashboard', 'uuid' => $d1['uuid'], 'action' => 'move']]])->assertOk()->json('items'))->keyBy('name');
        $this->assertSame([['keep', 'archive'], 'keep'], [$items['Shop']['actions'], $items['Shop']['action']]);
        $this->assertSame([['keep'], 'keep'], [$items['Fleet']['actions'], $items['Fleet']['action']]);
        $this->assertSame([['keep', 'archive'], 'keep'], [$items['Shop low flow']['actions'], $items['Shop low flow']['action']]);

        // In A, archiving an automation needs Workflow.manage and Workflow.activate; the dashboard's owner may archive it.
        $this->join($this->mover, $this->b, OrganizationRoleName::ORGANIZATION_ADMIN);
        $roles->syncMemberRoles($this->a, $this->mover, [$roles->create($this->a, $this->mover, 'Device mover', ['Device.view', 'Device.move', 'Dashboard.view'])->id]);
        $items = collect($this->review($this->a, $this->b, [$x])->assertOk()->json('items'))->keyBy('name');
        $this->assertSame(['move', 'keep', 'archive'], $items['Shop']['actions']);
        $this->assertSame(['move', 'keep'], $items['Shop low flow']['actions']);
    }

    public function test_a_running_automation_arrives_off_when_it_sends_commands_or_automations_are_off_in_the_target(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        $valve = $this->automation($this->a, 'Valve', [$x]);
        $graph = $valve->workflow;
        $graph['nodes'][] = ['id' => 'close', 'type' => WorkflowRewrite::COMMAND, 'config' => ['binding' => 'flow_0', 'value' => 0, 'cooldown_seconds' => 60, 'ttl_seconds' => 30]];
        $valve->update(['workflow' => $graph]);
        $this->automationsOn($this->b);

        $item = $this->review($this->a, $this->b, [$x])->json('items.0');
        $this->assertSame([false, 'Moves to Harbour Shop and arrives off, because it sends device commands.'], [$item['arrives_running'], $item['outcome']]);
        $move = $this->moved($this->a, $this->b, [$x]);
        $this->applied($this->successor($x));
        $moved = Workflow::where('organization_id', $this->b->id)->where('name', 'Valve')->firstOrFail();
        $this->assertSame([0, 'inactive'], [$moved->deployment_generation, $moved->deployment_status]);
        $this->assertSame([['kind' => 'automation', 'uuid' => $moved->uuid, 'name' => 'Valve', 'reason' => 'Turn it on in Harbour Shop: it arrived off because it sends device commands.']],
            $this->getJson($this->in($this->b).'/device-moves/'.$move['uuid'])->json('data.needs_attention'));

        $this->automation($this->a, 'Y flow', [$y]);
        $this->automationsOn($this->b, false);
        $this->assertSame('Moves to Harbour Shop and arrives off, because automations are turned off in Harbour Shop. Nobody can change or turn it on there until automations are turned on in Harbour Shop.',
            $this->review($this->a, $this->b, [$y])->json('items.0.outcome'));
        $move = $this->moved($this->a, $this->b, [$y]);
        $this->applied($this->successor($y));
        $this->assertSame(['Turn it on in Harbour Shop: it arrived off because automations are turned off in Harbour Shop.'], array_column($this->getJson($this->in($this->b).'/device-moves/'.$move['uuid'])->json('data.needs_attention'), 'reason'));
        $this->assertSame(0, Workflow::where('organization_id', $this->b->id)->where('name', 'Y flow')->value('deployment_generation'));
    }

    /** FR-039: where automations are off, a mover who may turn them on there can choose to, and the cutover does first. */
    public function test_a_mover_may_turn_automations_on_where_an_automation_moves(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->automation($this->a, 'Shop low flow', [$x]);

        $review = $this->review($this->a, $this->b, [$x])->assertOk()->json();
        $this->assertSame(['enabled' => false, 'offered' => true, 'turn_on' => false], $review['automations']);
        $this->assertSame([false, 'Moves to Harbour Shop and arrives off, because automations are turned off in Harbour Shop. Nobody can change or turn it on there until automations are turned on in Harbour Shop.'],
            [$review['items'][0]['arrives_running'], $review['items'][0]['outcome']]);
        $this->assertContains('Automations are turned off in Harbour Shop. Until someone turns them on there, the automation that moves can’t be changed or turned on.', $review['summary']);

        $turnOn = ['turn_on_automations' => true];
        $review = $this->review($this->a, $this->b, [$x], $turnOn)->assertOk()->json();
        $this->assertSame(['enabled' => false, 'offered' => true, 'turn_on' => true], $review['automations']);
        $this->assertSame([true, 'Moves to Harbour Shop and keeps running there once its devices are active.'], [$review['items'][0]['arrives_running'], $review['items'][0]['outcome']]);
        $this->assertContains('Automations are turned on in Harbour Shop.', $review['summary']);
        // The choice is part of the hash, so a confirmation must ask for what was reviewed.
        $this->postJson($this->in($this->a).'/device-moves', ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => [$x->uuid], ...$turnOn,
            'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $this->review($this->a, $this->b, [$x])->json('preview_hash')])->assertConflict();
        // Keeping the automation in the source leaves nothing to turn on.
        $kept = $this->review($this->a, $this->b, [$x], [...$turnOn, 'items' => [['kind' => 'automation', 'uuid' => $review['items'][0]['uuid'], 'action' => 'keep']]])->json('automations');
        $this->assertSame(['enabled' => false, 'offered' => false, 'turn_on' => false], $kept);

        $move = $this->moved($this->a, $this->b, [$x], $turnOn);
        $this->assertTrue($this->getJson($this->in($this->b).'/workflows/dag/settings')->assertOk()->json('data.enabled'));
        $this->assertSame(1, DB::table('activity_log')->where('organization_id', $this->b->id)->where('event', 'automation.settings_changed')->where('properties->move_uuid', $move['uuid'])->count());
        $this->applied($this->successor($x));
        $moved = Workflow::where('organization_id', $this->b->id)->where('name', 'Shop low flow')->firstOrFail();
        $this->assertNotNull($moved->desired_deployment_uuid);
        $this->assertSame([], $this->getJson($this->in($this->b).'/device-moves/'.$move['uuid'])->json('data.needs_attention'));
    }

    /** FR-039: without turning them on, the moved automation shows its nodes but waits for automations, and Done says so. */
    public function test_an_automation_that_moves_where_automations_are_off_shows_and_waits(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->automation($this->a, 'Shop low flow', [$x], running: false);

        $this->assertSame('Moves to Harbour Shop, off as it is now. Nobody can change or turn it on there until automations are turned on in Harbour Shop.',
            $this->review($this->a, $this->b, [$x])->json('items.0.outcome'));
        $move = $this->moved($this->a, $this->b, [$x]);
        $this->assertFalse(DeviceMove::where('uuid', $move['uuid'])->firstOrFail()->turns_on_automations);
        $this->applied($this->successor($x));
        $moved = Workflow::where('organization_id', $this->b->id)->where('name', 'Shop low flow')->firstOrFail();
        $attention = fn (): array => $this->getJson($this->in($this->b).'/device-moves/'.$move['uuid'])->assertOk()->json('data.needs_attention');
        $this->assertSame([['kind' => 'automation', 'uuid' => $moved->uuid, 'name' => 'Shop low flow', 'reason' => 'Turn on automations in Harbour Shop to change or run it.']], $attention());
        // Only members of the target are told.
        $this->as($this->aOnly, fn () => $this->assertSame([], $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->assertOk()->json('data.needs_attention')));

        $workflows = $this->in($this->b).'/workflows';
        $this->getJson($workflows.'/'.$moved->uuid)->assertOk();
        $this->getJson($workflows.'/dag/node-types')->assertOk()->assertJsonPath('data.0.type', 'compare.v1');
        $this->getJson($workflows.'/'.$moved->uuid.'/scenarios')->assertOk();
        $this->putJson($workflows.'/'.$moved->uuid, ['name' => 'Shop low flow', 'workflow' => $moved->workflow, 'draft_revision' => $moved->draft_revision])
            ->assertForbidden()->assertJsonPath('message', 'Automations are turned off in this organization.');

        $this->automationsOn($this->b);
        $this->assertSame([], $attention());
    }

    /** FR-039: turning automations on is the settings toggle's, so it needs Workflow.activate in the target, and still at cutover. */
    public function test_only_a_mover_who_may_turn_automations_on_is_offered_it(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $this->automation($this->a, 'Shop low flow', [$x]);
        $roles = app(OrganizationRoleManager::class);
        $builder = $roles->create($this->b, $this->mover, 'Automation builder', ['Device.view', 'Device.move', 'Workflow.view', 'Workflow.manage'])->id;

        $move = $this->confirm($this->a, $this->b, [$x], ['turn_on_automations' => true])->assertAccepted()->json('data');
        $roles->syncMemberRoles($this->b, $this->mover, [$builder]);
        $this->answerStops();
        $failed = $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->assertOk()->json('data');
        $this->assertSame(['failed', 'The person who moved the devices can no longer turn on automations in Harbour Shop.'], [$failed['status'], $failed['failure_reason']]);
        $this->assertFalse(DB::table('automation_settings')->where('organization_id', $this->b->id)->where('enabled', true)->exists());

        // Without it, the move is still offered, but turning automations on isn't.
        $x->refresh();
        $this->applied($x);
        $review = $this->review($this->a, $this->b, [$x->fresh()], ['turn_on_automations' => true])->assertOk()->json();
        $this->assertSame(['move', 'keep', 'archive'], $review['items'][0]['actions']);
        $this->assertSame(['enabled' => false, 'offered' => false, 'turn_on' => false], $review['automations']);
    }

    public function test_adding_the_other_devices_recomputes_every_row(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        $d2 = $this->dashboard($this->a, 'Fleet', [$x, $y]);
        $this->automation($this->a, 'Fleet low flow', [$x, $y]);
        $choices = ['items' => [['kind' => 'dashboard', 'uuid' => $d2['uuid'], 'action' => 'keep']]];

        $first = collect($this->review($this->a, $this->b, [$x], $choices)->json('items'))->keyBy('name');
        $this->assertSame([$y->uuid], $first['Fleet low flow']['other_devices']['device_uuids']);
        $both = collect($this->review($this->a, $this->b, [$x, $y], $choices)->json('items'))->keyBy('name');
        $this->assertSame([true, ['move', 'keep', 'archive'], 'keep', null], [$both['Fleet']['uses_only_moving'], $both['Fleet']['actions'], $both['Fleet']['action'], $both['Fleet']['other_devices']]);
        $this->assertSame([true, 'move'], [$both['Fleet low flow']['uses_only_moving'], $both['Fleet low flow']['action']]);

        // An archived device can't be added.
        $z = $this->unsourced('Meter Z');
        $this->dashboard($this->a, 'With Z', [$x]);
        Dashboard::where('name', 'With Z')->firstOrFail()->update(['widgets' => [...Dashboard::where('name', 'With Z')->value('widgets'), ['id' => 'z', 'type' => 'device_health', 'title' => 'Z', 'config' => ['sources' => [], 'devices' => [['device_uuid' => $z->uuid]]]]]]);
        $z->update(['lifecycle' => 'archived']);
        $this->assertSame(['count' => 1, 'can_add' => false, 'device_uuids' => []], collect($this->review($this->a, $this->b, [$x])->json('items'))->firstWhere('name', 'With Z')['other_devices']);
    }

    /** FR-038, SC-010: every dashboard and automation names devices of its own organization only. */
    private function assertNoDashboardOrAutomationCrosses(): void
    {
        foreach ([$this->a, $this->b] as $organization) {
            $own = Device::where('organization_id', $organization->id)->pluck('uuid')->flip();
            foreach (Dashboard::where('organization_id', $organization->id)->get() as $dashboard) {
                foreach (DashboardRewrite::devices($dashboard->widgets ?? []) as $uuid) {
                    $this->assertTrue($own->has($uuid), $dashboard->name.' in '.$organization->name.' names a device of another organization.');
                }
            }
            foreach (Workflow::where('organization_id', $organization->id)->get() as $workflow) {
                foreach (WorkflowRewrite::devices($workflow->workflow ?? []) as $uuid) {
                    $this->assertTrue($own->has($uuid), $workflow->name.' in '.$organization->name.' binds a device of another organization.');
                }
            }
        }
    }
}
