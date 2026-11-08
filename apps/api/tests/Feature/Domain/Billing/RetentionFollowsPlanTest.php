<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Retention follows the billing account (spec 029 US4, FR-018 to FR-022, SC-012): an
 * organization's override, else its account's retention allowance, else the platform.
 * A billing change that shortens it needs confirmation and waits 30 days, owners are
 * warned at the change and 7 days before, and undoing it in time deletes nothing.
 */
final class RetentionFollowsPlanTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private BillingAccount $account;

    private Organization $lakeside;

    private Organization $harbour;

    private BillingPlan $long;

    private BillingPlan $short;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->travelTo(CarbonImmutable::parse('2026-11-08 10:00:00', 'UTC'));
        config(['devices.runtime_token' => str_repeat('t', 40)]);
        $this->admin = User::factory()->create(['is_super_admin' => true]);
        $this->account = BillingAccount::factory()->ownedBy(User::factory()->create())->create(['name' => 'Integrator Billing']);
        $this->lakeside = Organization::factory()->forBillingAccount($this->account)->create(['name' => 'Lakeside Home']);
        $this->harbour = Organization::factory()->forBillingAccount($this->account)->create(['name' => 'Harbour Works']);
        $this->long = BillingPlan::factory()->withAllowances(['retention_days' => 90])->create(['name' => 'Long']);
        $this->short = BillingPlan::factory()->withAllowances(['retention_days' => 7])->create(['name' => 'Short']);
        // From the 400-day default, a 90-day plan is itself a shortening.
        $this->actingAs($this->admin, 'sanctum')->putJson($this->planUrl(), ['plan_uuid' => $this->long->uuid, 'confirm_retention' => true])->assertOk();
        DB::table('telemetry_retention_floors')->delete();
        DB::table('billing_notices')->delete();
    }

    public function test_retention_resolves_override_then_billing_account_then_platform(): void
    {
        $this->assertSame([90, 'billing_account'], $this->effective($this->lakeside));

        $this->putJson($this->retentionUrl($this->harbour), ['days' => 120, 'revision' => 0])->assertOk()
            ->assertJsonPath('data.source', 'organization')
            ->assertJsonPath('data.billing_days', 90);
        $this->assertSame([120, 'organization'], $this->effective($this->harbour));

        $this->putJson($this->planUrl(), ['plan_uuid' => null])->assertOk();
        $this->assertSame([(int) config('devices.default_retention_days'), 'default'], $this->effective($this->lakeside));
        $this->putJson('/api/v1/admin/settings/telemetry-retention', ['days' => 200, 'revision' => 0, 'confirmed_reduction' => true])->assertOk();
        $this->assertSame([200, 'platform'], $this->effective($this->lakeside));
    }

    public function test_a_shorter_plan_needs_confirmation_and_cleanup_keeps_the_previous_period_for_30_days(): void
    {
        $this->putJson($this->retentionUrl($this->harbour), ['days' => 90, 'revision' => 0])->assertOk();

        $refusal = $this->putJson($this->planUrl(), ['plan_uuid' => $this->short->uuid])
            ->assertStatus(409)
            ->assertJsonPath('retention.deletion_from', '2026-12-08T10:00:00Z')
            ->assertJsonPath('retention.organizations', [['uuid' => $this->lakeside->uuid, 'name' => 'Lakeside Home', 'from_days' => 90, 'to_days' => 7]]);
        $this->assertStringContainsString('8 December 2026', (string) $refusal->json('message'));
        $this->assertSame([90, 'billing_account'], $this->effective($this->lakeside));

        $this->putJson($this->planUrl(), ['plan_uuid' => $this->short->uuid, 'confirm_retention' => true])->assertOk();

        $this->assertSame([7, 'billing_account'], $this->effective($this->lakeside));
        $this->assertSame(90, app(RetentionService::class)->cleanupDays($this->lakeside));
        $this->getJson($this->retentionUrl($this->lakeside))->assertOk()
            ->assertJsonPath('data.pending_reduction', ['days' => 7, 'from' => '2026-12-08T10:00:00Z']);
        $this->assertSame(['days' => 90, 'reason' => 'plan_changed'], (array) DB::table('telemetry_retention_floors')->where('organization_id', $this->lakeside->id)->first(['days', 'reason']));
        // The organization with its own override is untouched.
        $this->assertSame(0, DB::table('telemetry_retention_floors')->where('organization_id', $this->harbour->id)->count());
        $this->assertSame([$this->lakeside->uuid.':2026-12-08'], DB::table('billing_notices')->where('kind', 'retention_reduction')->pluck('key')->all());

        $state = collect($this->withToken(str_repeat('t', 40))->getJson('/api/internal/devices/state')->assertOk()->json('retention'))->keyBy('organization_uuid');
        $this->assertSame([90, 'billing_account'], [$state[$this->lakeside->uuid]['days'], $state[$this->lakeside->uuid]['source']]);

        $this->travelTo(CarbonImmutable::parse('2026-12-08 10:00:01', 'UTC'));
        $this->assertSame(7, app(RetentionService::class)->cleanupDays($this->lakeside));
    }

    public function test_moving_back_within_the_grace_deletes_nothing(): void
    {
        $this->putJson($this->planUrl(), ['plan_uuid' => $this->short->uuid, 'confirm_retention' => true])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-22 10:00:00', 'UTC'));

        // Lengthening applies at once, without confirmation.
        $this->putJson($this->planUrl(), ['plan_uuid' => $this->long->uuid])->assertOk();

        $this->assertSame([90, 'billing_account'], $this->effective($this->lakeside));
        $this->assertNull($this->getJson($this->retentionUrl($this->lakeside))->json('data.pending_reduction'));
        foreach (['2026-11-22', '2026-12-08 10:00:01', '2027-01-30'] as $at) {
            $this->travelTo(CarbonImmutable::parse($at, 'UTC'));
            $this->assertSame(90, app(RetentionService::class)->cleanupDays($this->lakeside), "cleanup at {$at}");
        }
    }

    public function test_two_reductions_in_a_row_keep_the_longest_period_of_the_last_30_days(): void
    {
        $middle = BillingPlan::factory()->withAllowances(['retention_days' => 30])->create(['name' => 'Middle']);
        $this->putJson($this->planUrl(), ['plan_uuid' => $middle->uuid, 'confirm_retention' => true])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-18 10:00:00', 'UTC'));
        $this->putJson($this->planUrl(), ['plan_uuid' => $this->short->uuid, 'confirm_retention' => true])->assertOk();

        foreach (['2026-11-20' => 90, '2026-12-10' => 30, '2026-12-19' => 7] as $at => $days) {
            $this->travelTo(CarbonImmutable::parse($at, 'UTC'));
            $this->assertSame($days, app(RetentionService::class)->cleanupDays($this->lakeside), "cleanup on {$at}");
        }
    }

    public function test_plan_edits_account_overrides_and_moves_are_guarded_too(): void
    {
        $this->patchJson('/api/v1/admin/billing-plans/'.$this->long->uuid, ['allowances' => ['retention_days' => 14], 'confirm_affected' => 1])
            ->assertStatus(409)
            ->assertJsonCount(2, 'retention.organizations');
        $this->patchJson('/api/v1/admin/billing-plans/'.$this->long->uuid, ['allowances' => ['retention_days' => 60], 'confirm_affected' => 1, 'confirm_retention' => true])->assertOk();
        $this->assertSame(2, DB::table('telemetry_retention_floors')->where('reason', 'plan_edited')->count());

        $this->putJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/allowances/retention_days', ['value' => 30, 'note' => 'Shorter terms'])->assertStatus(409);
        $this->putJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/allowances/retention_days', ['value' => 30, 'note' => 'Shorter terms', 'confirm_retention' => true])->assertOk();
        $this->assertSame(2, DB::table('telemetry_retention_floors')->where('reason', 'override')->count());
        // Removing the override goes back to the plan's 60 days: longer, so no question.
        $this->deleteJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/allowances/retention_days')->assertOk();

        $elsewhere = BillingAccount::factory()->create();
        $this->putJson('/api/v1/admin/billing-accounts/'.$elsewhere->uuid.'/allowances/retention_days', ['value' => 10, 'note' => 'Short'])->assertOk();
        $this->putJson('/api/v1/admin/organizations/'.$this->lakeside->uuid.'/billing-account', ['billing_account_uuid' => $elsewhere->uuid])
            ->assertStatus(409)
            ->assertJsonPath('retention.organizations.0.to_days', 10);
        $this->putJson('/api/v1/admin/organizations/'.$this->lakeside->uuid.'/billing-account', ['billing_account_uuid' => $elsewhere->uuid, 'confirm_retention' => true])->assertNoContent();
        $this->assertSame(1, DB::table('telemetry_retention_floors')->where('reason', 'organization_moved')->count());
    }

    public function test_direct_changes_on_settings_keep_todays_immediate_behaviour(): void
    {
        $this->putJson($this->retentionUrl($this->lakeside), ['days' => 30, 'revision' => 0])->assertUnprocessable();
        $this->putJson($this->retentionUrl($this->lakeside), ['days' => 30, 'revision' => 0, 'confirmed_reduction' => true])->assertOk();

        $this->assertSame(30, app(RetentionService::class)->cleanupDays($this->lakeside));
        $this->assertSame(0, DB::table('telemetry_retention_floors')->count());
    }

    public function test_owners_are_emailed_at_the_change_and_once_7_days_before(): void
    {
        $this->putJson($this->planUrl(), ['plan_uuid' => $this->short->uuid, 'confirm_retention' => true])->assertOk();

        $this->artisan('billing:retention-warnings', ['--now' => '2026-11-30 10:00:00'])->expectsOutput('Warned owners about 0 retention reductions.');
        $this->artisan('billing:retention-warnings', ['--now' => '2026-12-02 08:00:00'])->expectsOutput('Warned owners about 2 retention reductions.');
        $this->artisan('billing:retention-warnings', ['--now' => '2026-12-03 08:00:00'])->expectsOutput('Warned owners about 0 retention reductions.');

        $keys = fn (string $kind): array => DB::table('billing_notices')->where('billing_account_id', $this->account->id)->where('kind', $kind)->orderBy('key')->pluck('key')->all();
        $expected = collect([$this->lakeside, $this->harbour])->map(fn (Organization $organization): string => $organization->uuid.':2026-12-08')->sort()->values()->all();
        $this->assertSame($expected, $keys('retention_reduction'));
        $this->assertSame($expected, $keys('retention_warning'));

        $this->artisan('billing:prune', ['--now' => '2026-12-09 00:00:00'])->expectsOutput('Pruned 0 billing notices and 2 retention floors.');
    }

    public function test_a_floor_that_was_undone_sends_no_warning(): void
    {
        $this->putJson($this->planUrl(), ['plan_uuid' => $this->short->uuid, 'confirm_retention' => true])->assertOk();
        $this->putJson($this->planUrl(), ['plan_uuid' => $this->long->uuid])->assertOk();

        $this->artisan('billing:retention-warnings', ['--now' => '2026-12-02 08:00:00'])->expectsOutput('Warned owners about 0 retention reductions.');
    }

    public function test_without_a_retention_allowance_nothing_changes(): void
    {
        $plain = BillingPlan::factory()->withAllowances(['alerts' => 10])->create(['name' => 'Plain']);
        $this->putJson($this->planUrl(), ['plan_uuid' => null])->assertOk();
        $before = $this->effective($this->lakeside);

        $this->putJson($this->planUrl(), ['plan_uuid' => $plain->uuid])->assertOk();

        $this->assertSame($before, $this->effective($this->lakeside));
        $this->assertSame([(int) config('devices.default_retention_days'), 'default'], $before);
    }

    private function planUrl(): string
    {
        return '/api/v1/admin/billing-accounts/'.$this->account->uuid.'/plan';
    }

    private function retentionUrl(Organization $organization): string
    {
        return '/api/v1/admin/organizations/'.$organization->uuid.'/settings/telemetry-retention';
    }

    /**
     * @return array{0: int, 1: string}
     */
    private function effective(Organization $organization): array
    {
        $effective = app(RetentionService::class)->effective($organization->fresh());

        return [$effective['days'], $effective['source']];
    }
}
