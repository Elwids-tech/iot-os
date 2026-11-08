<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Models\BillingAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * `billing:prune` keeps billing email notices for 13 months (constitution VII). Each key
 * carries its month, so a pruned key is never due again.
 */
final class PruneBillingTest extends TestCase
{
    use RefreshDatabase;

    public function test_notices_older_than_13_months_are_deleted(): void
    {
        $account = BillingAccount::factory()->create();
        foreach (['alerts:2025-09:80' => '2025-09-14 10:00:00', 'alerts:2025-10:80' => '2025-10-20 10:00:00', 'alerts:2026-11:80' => '2026-11-03 10:00:00'] as $key => $sentAt) {
            DB::table('billing_notices')->insert(['billing_account_id' => $account->id, 'kind' => 'usage_threshold', 'key' => $key, 'sent_at' => $sentAt]);
        }

        $this->artisan('billing:prune', ['--now' => '2026-11-07 12:00:00'])
            ->expectsOutput('Pruned 1 billing notices.')
            ->assertSuccessful();

        $this->assertSame(['alerts:2025-10:80', 'alerts:2026-11:80'], DB::table('billing_notices')->orderBy('key')->pluck('key')->all());
    }
}
