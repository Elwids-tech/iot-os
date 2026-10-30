<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The assignment invariants of spec 023 (data-model.md): an organization's periods meet
 * with no gap or overlap, an existing organization has exactly one open period on its
 * current account, and a deleted one has none.
 */
trait AssertsBillingAssignments
{
    private function assertBillingAssignmentInvariants(Organization|string $organization): void
    {
        $uuid = $organization instanceof Organization ? $organization->uuid : $organization;
        $rows = DB::table('billing_account_assignments')->where('organization_uuid', $uuid)->orderBy('started_at')->get();

        $this->assertNotEmpty($rows, "Organization {$uuid} has no billing assignment.");

        foreach ($rows->slice(0, -1)->values() as $index => $row) {
            $next = $rows[$index + 1];
            $this->assertNotNull($row->ended_at, 'Only the latest assignment may be open.');
            $this->assertTrue(
                CarbonImmutable::parse($row->ended_at)->equalTo(CarbonImmutable::parse($next->started_at)),
                "Assignment ending {$row->ended_at} does not meet the next one starting {$next->started_at}.",
            );
        }

        $existing = Organization::withTrashed()->where('uuid', $uuid)->first();
        $open = $rows->whereNull('ended_at');

        if ($existing === null) {
            $this->assertCount(0, $open, 'A deleted organization keeps no open assignment.');

            return;
        }

        $this->assertCount(1, $open, 'An organization has exactly one open assignment.');
        $this->assertSame((int) $existing->billing_account_id, (int) $open->first()->billing_account_id);
    }
}
