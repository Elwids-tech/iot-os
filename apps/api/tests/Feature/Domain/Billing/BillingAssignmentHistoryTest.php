<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class BillingAssignmentHistoryTest extends TestCase
{
    use AssertsBillingAssignments, RefreshDatabase;

    public function test_an_organization_created_without_an_account_gets_its_own_named_after_it(): void
    {
        $fromFactory = Organization::factory()->create(['name' => 'Corner Shop']);
        $fromBootstrap = Organization::query()->create(['name' => 'Lakeside Home', 'slug' => 'lakeside-home']);

        foreach ([$fromFactory, $fromBootstrap] as $organization) {
            $account = $organization->billingAccount;

            $this->assertSame($organization->name, $account->name);
            $this->assertSame(1, $account->organization_limit);
            $this->assertNull(DB::table('billing_account_assignments')->where('organization_id', $organization->id)->value('assigned_by'));
            $this->assertBillingAssignmentInvariants($organization);
        }

        $this->assertNotSame($fromFactory->billing_account_id, $fromBootstrap->billing_account_id);
    }

    public function test_organizations_on_a_shared_account_record_who_assigned_them(): void
    {
        $administrator = User::factory()->create();
        $account = BillingAccount::factory()->create(['name' => 'Example Integrations']);

        $this->actingAs($administrator);
        $first = Organization::factory()->forBillingAccount($account)->create();
        $second = Organization::factory()->forBillingAccount($account)->create();

        $this->assertSame(1, BillingAccount::query()->count());
        $this->assertSame([$first->id, $second->id], $account->organizations()->orderBy('id')->pluck('id')->all());
        $this->assertSame(
            [$administrator->id, $administrator->id],
            DB::table('billing_account_assignments')->where('billing_account_id', $account->id)->orderBy('id')->pluck('assigned_by')->map(fn ($id): int => (int) $id)->all(),
        );
    }

    public function test_an_organization_cannot_have_two_open_assignments(): void
    {
        $organization = Organization::factory()->create();

        $this->expectException(UniqueConstraintViolationException::class);

        DB::table('billing_account_assignments')->insert([
            'billing_account_id' => BillingAccount::factory()->create()->id,
            'organization_id' => $organization->id,
            'organization_uuid' => $organization->uuid,
            'organization_name' => $organization->name,
            'started_at' => now(),
        ]);
    }

    public function test_the_rollout_check_finds_no_gap_or_overlap_after_moves_and_deletions(): void
    {
        $administrator = User::factory()->create(['is_super_admin' => true]);
        $target = BillingAccount::factory()->create();
        $later = BillingAccount::factory()->create();
        $moved = Organization::factory()->create();
        Organization::factory()->create();
        $deleted = Organization::factory()->create();

        app(BillingAccounts::class)->move($moved, $target, $administrator);
        $this->travel(5)->seconds();
        app(BillingAccounts::class)->move($moved->fresh(), $later, $administrator);
        $this->actingAs($administrator, 'sanctum')
            ->deleteJson('/api/v1/admin/organizations/'.$deleted->uuid.'?slug='.$deleted->slug)
            ->assertNoContent();

        $this->assertBillingAssignmentInvariants($moved);
        $this->assertBillingAssignmentInvariants($deleted->uuid);

        // The quickstart's SC-002 queries: one current assignment per organization, and no gap or overlap.
        $withoutCurrent = DB::select(<<<'SQL'
            select o.uuid
            from organizations o
            left join billing_account_assignments a
              on a.organization_uuid = o.uuid and a.ended_at is null
            where a.id is null or a.billing_account_id <> o.billing_account_id
            SQL);
        $gaps = DB::select(<<<'SQL'
            select organization_uuid
            from (
              select organization_uuid, ended_at,
                     lead(started_at) over (partition by organization_uuid order by started_at) as next_started_at
              from billing_account_assignments
            ) a
            where next_started_at is not null
              and (ended_at is null or ended_at <> next_started_at)
            SQL);

        $this->assertSame([], $withoutCurrent);
        $this->assertSame([], $gaps);
    }
}
