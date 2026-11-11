<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\DeviceLimit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Domain\Devices\Moves\MoveTestCase;

/**
 * A move hands a device's place to its successor (spec 031, research R4): nothing is
 * claimed or checked, so it succeeds at the limit, and the count and the peak don't move.
 */
final class DeviceLimitTransferTest extends MoveTestCase
{
    public function test_a_transfer_at_the_limit_keeps_the_count_and_the_peak(): void
    {
        $x = $this->adapterFed('WM-1001', 'Tracker X');
        $account = BillingAccount::findOrFail($this->a->billing_account_id);
        $limit = app(DeviceLimit::class);
        app(Allowances::class)->override($account, AllowanceKind::Devices, $limit->count($account)['total'], 'At the limit', $this->mover);
        $successor = $this->unsourced('Successor', $this->b);
        [$count, $peak, $place] = [$limit->count($account)['total'], $limit->peak($account, CarbonImmutable::now()), $x->limit_place_at];

        DB::transaction(fn () => $limit->transfer($x, $successor));

        $this->assertNull($x->fresh()->limit_place_at);
        $this->assertEquals($place, $successor->fresh()->limit_place_at);
        $this->assertSame($count, $limit->count($account)['total']);
        $this->assertSame($peak, $limit->peak($account, CarbonImmutable::now()));
        $this->assertSame(['Harbour Shop' => 1], collect($limit->count($account)['organizations'])->pluck('count', 'name')->only('Harbour Shop')->all());
    }
}
