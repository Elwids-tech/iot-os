<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Services\BillingAccountBackfill;
use App\Domain\Shared\Models\Organization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class BillingAccountBackfillTest extends TestCase
{
    use AssertsBillingAssignments, RefreshDatabase;

    public function test_the_rollout_gives_every_organization_its_own_account_from_its_creation(): void
    {
        // The device move, invoice, data point, usage and plans migrations reference billing
        // accounts, so they go first and come back last; PostgreSQL refuses to drop a table
        // others point at. Carried items and archive columns point at device moves. Sign-ups
        // (spec 035) point at billing accounts too, and so do brands and their images (spec
        // 036), which organizations' logos point at, and portal addresses.
        $addresses = require database_path('migrations/2026_11_30_000100_create_portal_addresses_table.php');
        $logos = require database_path('migrations/2026_11_28_000300_add_logos_to_organizations.php');
        $brands = require database_path('migrations/2026_11_28_000200_create_brands_table.php');
        $brandAssets = require database_path('migrations/2026_11_28_000100_create_brand_assets_table.php');
        $signUps = require database_path('migrations/2026_11_26_000100_create_sign_ups_tables.php');
        $items = require database_path('migrations/2026_11_20_000006_create_device_move_items.php');
        $moves = require database_path('migrations/2026_11_20_000002_create_device_moves.php');
        $payments = require database_path('migrations/2026_11_16_000000_add_billing_payments.php');
        $invoices = require database_path('migrations/2026_11_15_000000_create_billing_invoices.php');
        $dataPoints = require database_path('migrations/2026_11_08_100000_create_data_point_buckets.php');
        $usage = require database_path('migrations/2026_11_07_200000_create_billing_usage.php');
        $plans = require database_path('migrations/2026_11_07_100000_create_billing_plans.php');
        $migration = require database_path('migrations/2026_10_31_000000_create_billing_accounts.php');
        $addresses->down();
        $logos->down();
        $brands->down();
        $brandAssets->down();
        $signUps->down();
        $items->down();
        $moves->down();
        $payments->down();
        $invoices->down();
        $dataPoints->down();
        $usage->down();
        $plans->down();
        $migration->down();

        $this->organization('Corner Shop', '2026-03-01 08:00:00');
        $this->organization('Lakeside Home', '2026-05-12 17:30:00');
        $this->organization('Closed Workshop', '2026-01-20 09:15:00', deletedAt: '2026-06-01 10:00:00');

        $migration->up();
        BillingAccountBackfill::run();

        $this->assertSame(3, DB::table('billing_accounts')->count());
        $this->assertSame(3, DB::table('billing_account_assignments')->count());
        $this->assertSame(0, DB::table('billing_account_owners')->count());

        foreach (['Corner Shop' => '2026-03-01 08:00:00', 'Lakeside Home' => '2026-05-12 17:30:00', 'Closed Workshop' => '2026-01-20 09:15:00'] as $name => $createdAt) {
            $organization = Organization::withTrashed()->where('name', $name)->firstOrFail();
            $account = DB::table('billing_accounts')->find($organization->billing_account_id);
            $assignment = DB::table('billing_account_assignments')->where('organization_id', $organization->id)->sole();

            $this->assertSame($name, $account->name);
            $this->assertSame(1, (int) $account->organization_limit);
            $this->assertSame($organization->uuid, $assignment->organization_uuid);
            $this->assertSame($name, $assignment->organization_name);
            $this->assertSame($createdAt, Str::substr((string) $assignment->started_at, 0, 19));
            $this->assertNull($assignment->ended_at);
            $this->assertNull($assignment->assigned_by);
        }

        $this->assertBillingAssignmentInvariants(Organization::query()->where('name', 'Corner Shop')->firstOrFail());

        $plans->up();
        $usage->up();
        $dataPoints->up();
        $invoices->up();
        $payments->up();
        $moves->up();
        $items->up();
        $signUps->up();
        $this->assertSame(0, DB::table('billing_allowance_overrides')->count());
    }

    private function organization(string $name, string $createdAt, ?string $deletedAt = null): void
    {
        DB::table('organizations')->insert([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'slug' => Str::slug($name),
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
            'deleted_at' => $deletedAt,
        ]);
    }
}
