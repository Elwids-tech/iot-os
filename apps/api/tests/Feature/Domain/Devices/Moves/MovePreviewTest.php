<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Models\DeviceMoveDevice;
use App\Domain\Devices\Models\DeviceOperation;
use App\Domain\Devices\Models\DiscoveryCandidate;
use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Models\SparkplugConnection;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Services\Moves\MovePreview;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The review and the targets (spec 031 FR-002 to FR-006, contract § Targets and Review):
 * blockers, successor codes and sites, the 100-device limit, and who may move where.
 */
final class MovePreviewTest extends MoveTestCase
{
    public function test_targets_list_only_organizations_of_the_account_where_the_person_holds_device_move(): void
    {
        $targets = $this->getJson($this->in($this->a).'/device-move-targets')->assertOk()->json();
        $this->assertSame([['uuid' => $this->b->uuid, 'name' => 'Harbour Shop'], ['uuid' => $this->d->uuid, 'name' => 'Quay Store']], $targets['data']);
        // The mover owns no billing account, so it can't create one.
        $this->assertArrayNotHasKey('new_organization', $targets);

        // A member without Device.move in D does not get D.
        $this->join($this->mover, $this->d, OrganizationRoleName::MEMBER);
        $this->assertSame(['Harbour Shop'], array_column($this->getJson($this->in($this->a).'/device-move-targets')->json('data'), 'name'));

        // C's admin sees nothing of A or B.
        $this->as($this->cAdmin, fn () => $this->assertSame([], $this->getJson($this->in($this->c).'/device-move-targets')->assertOk()->json('data')));
        // Moderators and members don't hold Device.move.
        $moderator = $this->person('moderator-a', []);
        $this->join($moderator, $this->a, OrganizationRoleName::MODERATOR);
        $this->as($moderator, fn () => $this->getJson($this->in($this->a).'/device-move-targets')->assertForbidden());
    }

    public function test_an_owner_with_room_gets_new_organization_and_one_without_room_does_not(): void
    {
        $account = $this->a->billingAccount;
        $account->owners()->attach($this->mover->id, ['added_by' => $this->mover->id]);
        app(Allowances::class)->override($account, AllowanceKind::Organizations, $account->organizations()->count() + 1, 'Room for one more', $this->mover);

        $this->assertSame(['billing_account_uuid' => $account->uuid], $this->getJson($this->in($this->a).'/device-move-targets')->json('new_organization'));

        app(Allowances::class)->override($account, AllowanceKind::Organizations, $account->organizations()->count(), 'Full', $this->mover);
        $this->assertArrayNotHasKey('new_organization', $this->getJson($this->in($this->a).'/device-move-targets')->json());
    }

    public function test_the_review_names_the_pipe_endings_profile_copies_and_changes_nothing(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->unsourced('Spare meter');
        $before = $this->snapshot();

        $review = $this->review($this->a, $this->b, [$x, $y])->assertOk()->json();

        $this->assertTrue($review['can_confirm']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $review['preview_hash']);
        $this->assertSame(['kind' => 'adapter', 'name' => 'Vendor meters', 'outcome' => 'stays'], $review['devices'][0]['reports_through']);
        $this->assertNull($review['devices'][1]['reports_through']);
        $this->assertSame([true, false], array_column($review['devices'], 'arrives_active'));
        $this->assertSame(['name' => 'Tracker X', 'code' => 'tracker-x', 'site_uuid' => null], $review['devices'][0]['successor']);
        $this->assertCount(1, $review['profile_copies']);
        $this->assertSame([1, 'water-meter-onboarding-example', false], [$review['profile_copies'][0]['revision'], $review['profile_copies'][0]['code'], $review['profile_copies'][0]['reused']]);
        $this->assertTrue($review['pipe_owner_sees_raw_messages']);
        $this->assertSame(['offered' => false, 'include' => false], $review['history']);
        $this->assertSame([], $review['items']);
        $this->assertSame(['alerts' => 0, 'geofence_assignments' => 0, 'application_grants' => []], $review['ends']);
        $this->assertSame('2 devices move to Harbour Shop.', $review['summary'][0]);
        $this->assertContains('1 device keeps reporting through the adapter Vendor meters, which stays with Integrator.', $review['summary']);
        // The same situation gives the same hash.
        $this->assertSame($review['preview_hash'], $this->review($this->a, $this->b, [$x, $y])->json('preview_hash'));
        $this->assertSame($before, $this->snapshot());
    }

    public function test_every_blocker_stops_the_confirmation(): void
    {
        $archived = $this->unsourced('Old meter');
        $archived->update(['lifecycle' => 'archived']);
        $pending = $this->adapterFed('WM-1001', 'Pending meter');
        $this->postJson($this->in($this->a).'/devices/'.$pending->uuid.'/deactivate', ['draft_revision' => $pending->draft_revision])->assertAccepted();
        $operation = $this->unsourced('Busy meter');
        DeviceOperation::create(['uuid' => (string) Str::uuid(), 'device_id' => $operation->id, 'actor_id' => $this->mover->id, 'target_state' => 'inactive', 'kind' => 'deactivate',
            'expected_generation' => 0, 'generation' => 1, 'status' => 'pending', 'outstanding_key' => $operation->uuid, 'created_at' => now()]);
        $moving = $this->unsourced('Moving meter');
        $move = DeviceMove::create(['operation_uuid' => (string) Str::uuid(), 'request_hash' => str_repeat('a', 64), 'source_organization_id' => $this->a->id, 'target_organization_id' => $this->d->id,
            'billing_account_id' => $this->a->billing_account_id, 'mover_id' => $this->mover->id, 'origin' => 'devices', 'status' => 'stopping', 'review' => [], 'confirmed_at' => now()]);
        DeviceMoveDevice::create(['device_move_id' => $move->id, 'predecessor_device_id' => $moving->id, 'name' => 'Moving meter', 'code' => 'moving-meter', 'was_active' => false, 'arrives_active' => false, 'state' => 'waiting', 'outstanding_key' => $moving->id]);
        $behind = $this->behindGateway('Line meter');
        $direct = $this->direct('Direct meter');

        $review = $this->review($this->a, $this->b, [$archived, $pending, $operation, $moving, $behind, $direct])->assertOk()->json();

        $this->assertFalse($review['can_confirm']);
        $this->assertSame([[MovePreview::ARCHIVED], [MovePreview::WAITING], [MovePreview::WAITING], [MovePreview::MOVING], [MovePreview::GATEWAY], [MovePreview::DIRECT]], array_column($review['devices'], 'blockers'));
        $this->assertSame(['kind' => 'direct', 'name' => 'Direct meter', 'outcome' => 'moves'], $review['devices'][5]['reports_through']);
        $this->postJson($this->in($this->a).'/device-moves', ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => array_column($review['devices'], 'uuid'),
            'operation_uuid' => (string) Str::uuid(), 'preview_hash' => $review['preview_hash']])->assertUnprocessable()->assertJsonValidationErrors(['devices.0', 'devices.5']);
        $this->assertSame(1, DeviceMove::count());
        // A device in a move takes no other change.
        $this->postJson($this->in($this->a).'/devices/'.$moving->uuid.'/archive', ['draft_revision' => $moving->fresh()->draft_revision])->assertConflict();
    }

    public function test_successor_codes_must_be_free_in_the_target_and_in_the_move_and_sites_must_be_the_targets(): void
    {
        $x = $this->unsourced('Meter one');
        $y = $this->unsourced('Meter two');
        $this->unsourced('Taken', $this->b);
        $this->unsourced('Meter one', $this->b);
        $site = Site::create(['organization_id' => $this->a->id, 'name' => 'A yard', 'timezone' => 'UTC']);
        $theirs = Site::create(['organization_id' => $this->b->id, 'name' => 'Shop floor', 'timezone' => 'UTC']);

        // A default code that B uses gets the first free suffix.
        $this->assertSame(['meter-one-2', 'meter-two'], array_column(array_column($this->review($this->a, $this->b, [$x, $y])->json('devices'), 'successor'), 'code'));

        $review = $this->review($this->a, $this->b, [$x, $y], ['devices' => [['uuid' => $x->uuid, 'code' => 'taken'], ['uuid' => $y->uuid, 'code' => 'twin', 'site_uuid' => $theirs->uuid]]])->assertOk()->json();
        $this->assertSame(['Code already used in Harbour Shop'], $review['devices'][0]['blockers']);
        $this->assertSame($theirs->uuid, $review['devices'][1]['successor']['site_uuid']);
        $this->assertFalse($review['can_confirm']);

        $twins = $this->review($this->a, $this->b, [$x, $y], ['devices' => [['uuid' => $x->uuid, 'code' => 'twin'], ['uuid' => $y->uuid, 'code' => 'twin']]])->json('devices');
        $this->assertSame([[], ['Code already used by another device in this move']], array_column($twins, 'blockers'));

        $this->review($this->a, $this->b, [$x], ['devices' => [['uuid' => $x->uuid, 'site_uuid' => $site->uuid]]])->assertUnprocessable()->assertJsonValidationErrors(['devices.0.site_uuid' => 'Choose a site of Harbour Shop.']);
        $this->review($this->a, $this->b, [$x], ['devices' => [['uuid' => $y->uuid, 'name' => 'Not moving']]])->assertUnprocessable()->assertJsonValidationErrors('devices.0.uuid');
    }

    public function test_at_most_100_devices_and_nothing_from_later_pull_requests(): void
    {
        $x = $this->unsourced('Meter one');
        $this->postJson($this->in($this->a).'/device-moves/preview', ['target_organization_uuid' => $this->b->uuid, 'device_uuids' => array_map(fn () => (string) Str::uuid(), range(1, 101))])
            ->assertUnprocessable()->assertJsonValidationErrors(['device_uuids' => 'Move at most 100 devices at a time.']);
        $this->review($this->a, $this->b, [$x], ['include_history' => true])->assertUnprocessable()->assertJsonValidationErrors(['include_history' => 'Readings from before the move can’t be included yet.']);
        $this->review($this->a, $this->b, [$x], ['items' => [['kind' => 'dashboard', 'uuid' => (string) Str::uuid(), 'action' => 'copy']]])->assertUnprocessable()->assertJsonValidationErrors('items');
        // A device of another organization is not found.
        $theirs = $this->unsourced('Their meter', $this->b);
        $this->review($this->a, $this->b, [$theirs])->assertNotFound();
    }

    public function test_targets_outside_the_account_or_without_membership_are_not_found_and_without_device_move_forbidden(): void
    {
        $x = $this->unsourced('Meter one');
        $this->review($this->a, $this->c, [$x])->assertNotFound();
        $this->review($this->a, $this->a, [$x])->assertNotFound();
        // Not a member of the target.
        $this->as($this->aOnly, fn () => $this->review($this->a, $this->b, [$x])->assertNotFound());
        // A member without Device.move.
        $this->join($this->aOnly, $this->b, OrganizationRoleName::MEMBER);
        $this->as($this->aOnly, fn () => $this->review($this->a, $this->b, [$x])->assertForbidden());
        // C can't name A or B, from its own organization or theirs.
        $this->as($this->cAdmin, function () use ($x): void {
            $this->review($this->c, $this->a, [$x])->assertNotFound();
            $this->review($this->c, $this->b, [$x])->assertNotFound();
            $this->review($this->a, $this->b, [$x])->assertForbidden();
        });
    }

    /** Every table a move writes, by row count, with the devices as they are. */
    private function snapshot(): array
    {
        return [
            ...collect(['device_moves', 'device_move_devices', 'device_links', 'device_profile_copies', 'device_profiles', 'device_outbox', 'device_operations', 'activity_log'])->mapWithKeys(fn ($table) => [$table => DB::table($table)->count()])->all(),
            'devices' => Device::orderBy('id')->get(['id', 'organization_id', 'lifecycle', 'draft_revision', 'deployment_generation', 'limit_place_at'])->toArray(),
        ];
    }

    private function behindGateway(string $name): Device
    {
        $connection = SparkplugConnection::create(['organization_id' => $this->a->id, 'name' => 'Plant', 'group_id' => 'plant-'.Str::random(6), 'host_id' => 'plant-host', 'username' => 'plant-'.Str::random(6), 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $this->a->id, 'sparkplug_connection_id' => $connection->id, 'name' => 'Line gateway', 'edge_node_id' => 'line-'.Str::random(6)]);

        return $this->holding($name, $gateway);
    }

    private function direct(string $name): Device
    {
        $connection = SparkplugConnection::firstOrCreate(['group_id' => 'onboarding-'.$this->a->uuid], ['organization_id' => $this->a->id, 'name' => 'Direct device connections', 'host_id' => 'iot-onboarding-'.$this->a->uuid, 'username' => 'host-'.Str::uuid(), 'password' => 'test-secret', 'status' => 'ready']);
        $gateway = SparkplugGateway::create(['organization_id' => $this->a->id, 'sparkplug_connection_id' => $connection->id, 'name' => $name, 'edge_node_id' => 'device-'.Str::uuid()]);

        return $this->holding($name, $gateway, '');
    }

    private function holding(string $name, SparkplugGateway $gateway, string $source = 'meter-1'): Device
    {
        $candidate = DiscoveryCandidate::create(['organization_id' => $this->a->id, 'sparkplug_gateway_id' => $gateway->id, 'source_device_id' => $source, 'birth_revision' => 1, 'metrics' => []]);
        $device = $this->unsourced($name);
        $device->forceFill(['device_discovery_candidate_id' => $candidate->id, 'reserved_source_uuid' => $candidate->uuid])->save();

        return $device->fresh();
    }
}
