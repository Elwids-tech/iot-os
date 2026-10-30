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
        $migration = require database_path('migrations/2026_10_31_000000_create_billing_accounts.php');
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
