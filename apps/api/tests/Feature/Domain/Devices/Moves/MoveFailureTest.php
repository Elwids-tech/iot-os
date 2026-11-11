<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices\Moves;

use App\Domain\Authorization\Enums\OrganizationRoleName;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\DeviceLimit;
use App\Domain\DeviceProfiles\Models\DeviceProfileCopy;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceLink;
use App\Domain\Devices\Models\DeviceMoveDevice;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * A move that can't finish (spec 031, research R1): a refused stop, or a re-check that
 * fails at cutover, fails it. The source ends as it started, nothing remains in the
 * target, and the device limit and its peak don't move.
 */
final class MoveFailureTest extends MoveTestCase
{
    public function test_a_refused_stop_fails_the_move_and_resumes_the_devices_it_stopped(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        [$count, $peak] = $this->usage();
        $move = $this->confirm($this->a, $this->b, [$x, $y])->assertAccepted()->json('data');

        // The runtime stops X, then refuses to stop Y.
        $rows = DeviceMoveDevice::orderBy('id')->get();
        $this->stop($x, $rows[0]->stop_operation_uuid);
        $this->assertSame('stopping', $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->json('data.status'));
        $this->refuse($y, $rows[1]->stop_operation_uuid);

        $failed = $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->assertOk()->json('data');
        $this->assertSame('failed', $failed['status']);
        $this->assertSame('The runtime could not stop Tracker Y: The source is busy.', $failed['failure_reason']);
        $this->assertSame(['failed', 'failed'], array_column($failed['devices'], 'state'));
        // X is resumed with its last applied configuration; Y never stopped.
        $this->assertSame(['pending', $x->last_applied_configuration_uuid], [$x->fresh()->deployment_status, $x->fresh()->desired_configuration_uuid]);
        $this->assertSame('resume', $x->fresh()->latestOperation->kind);
        $this->assertNull($x->fresh()->latestOperation->actor_id);
        $this->applied($x);
        $this->assertSame(['active', 'active'], [$x->fresh()->lifecycle, $y->fresh()->lifecycle]);
        $this->assertNothingInTheTarget();
        $this->assertSame([$count, $peak], $this->usage());
        $this->assertSame(0, DeviceMoveDevice::whereNotNull('outstanding_key')->count());
        $this->assertSame(1, DB::table('activity_log')->where('organization_id', $this->b->id)->where('event', 'device_move.failed')->count());
        // The devices can move again.
        $this->review($this->a, $this->b, [$x->fresh(), $y->fresh()])->assertOk()->assertJsonPath('can_confirm', true);
    }

    public function test_the_mover_losing_device_move_before_cutover_fails_it(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        [$count, $peak] = $this->usage();
        $move = $this->confirm($this->a, $this->b, [$x])->assertAccepted()->json('data');
        $this->join($this->mover, $this->b, OrganizationRoleName::MEMBER);

        $this->answerStops();

        $failed = $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->assertOk()->json('data');
        $this->assertSame(['failed', 'The person who moved the devices can no longer move devices between Integrator and Harbour Shop.'], [$failed['status'], $failed['failure_reason']]);
        $this->assertSame('pending', $x->fresh()->deployment_status);
        $this->assertNothingInTheTarget();
        $this->assertSame([$count, $peak], $this->usage());
    }

    public function test_the_target_leaving_the_account_before_cutover_fails_it(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $move = $this->confirm($this->a, $this->b, [$x])->assertAccepted()->json('data');
        // Leaving through the platform is refused while the move is stopping, so this changes the row behind its back.
        $this->b->forceFill(['billing_account_id' => BillingAccount::create(['name' => 'Elsewhere billing'])->id])->save();

        $this->answerStops();

        $this->assertSame('The organizations are no longer in one billing account.', $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->json('data.failure_reason'));
        $this->assertNothingInTheTarget();
        $this->assertSame('pending', $x->fresh()->deployment_status);
    }

    public function test_a_late_stop_after_the_move_failed_resumes_that_device(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $y = $this->adapterFed('WM-1002', 'Tracker Y');
        $move = $this->confirm($this->a, $this->b, [$x, $y])->assertAccepted()->json('data');
        $rows = DeviceMoveDevice::orderBy('id')->get();

        // Y is refused first: X is still stopping and stays in the move until the runtime answers.
        $this->refuse($y, $rows[1]->stop_operation_uuid);
        $this->assertSame('failed', $this->getJson($this->in($this->a).'/device-moves/'.$move['uuid'])->json('data.status'));
        $this->assertSame($x->id, DeviceMoveDevice::whereNotNull('outstanding_key')->value('predecessor_device_id'));
        $this->stop($x, $rows[0]->stop_operation_uuid);

        $this->assertSame(0, DeviceMoveDevice::whereNotNull('outstanding_key')->count());
        $this->assertSame(['pending', 'resume'], [$x->fresh()->deployment_status, $x->fresh()->latestOperation->kind]);
        $this->assertNothingInTheTarget();
    }

    private function stop(Device $device, string $operation): void
    {
        $device->refresh();
        $this->runtimeEvent('device.deactivated.v1', ['organization_uuid' => $this->a->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'operation_uuid' => $operation])->assertOk();
    }

    private function refuse(Device $device, string $operation): void
    {
        $device->refresh();
        $this->runtimeEvent('device.failed.v1', ['organization_uuid' => $this->a->uuid, 'device_uuid' => $device->uuid, 'generation' => $device->deployment_generation, 'operation_uuid' => $operation, 'diagnostic' => 'The source is busy.'])->assertOk();
    }

    /** @return array{0: int, 1: int} the account's device count and this month's peak */
    private function usage(): array
    {
        $limit = app(DeviceLimit::class);
        $account = BillingAccount::findOrFail($this->a->billing_account_id);

        return [$limit->count($account)['total'], $limit->peak($account, CarbonImmutable::now())];
    }

    private function assertNothingInTheTarget(): void
    {
        $this->assertSame(0, Device::where('organization_id', $this->b->id)->count());
        $this->assertSame(0, DeviceLink::count());
        $this->assertSame(0, DeviceProfileCopy::count());
        $this->assertSame(0, DB::table('device_profiles')->where('organization_id', $this->b->id)->count());
    }
}
