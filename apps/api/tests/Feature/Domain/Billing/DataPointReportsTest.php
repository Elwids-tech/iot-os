<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Jobs\DeliverBillingEmail;
use App\Domain\Billing\Mail\UsageThresholdMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Billing\Services\PlanAssignments;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\AssertsContracts;
use Tests\TestCase;

/**
 * The control plane's side of usage.data_points.v1 (spec 029 US3, ADR-036): cumulative
 * counts per organization and UTC hour become exact data point usage for the account the
 * organization belonged to at that hour, with overage, and a watermark that says when a
 * month is final.
 */
final class DataPointReportsTest extends TestCase
{
    use AssertsContracts;
    use RefreshDatabase;

    private const EVENT = 'usage.data_points.v1';

    private const TOKEN = 'data-point-reports-runtime-token-00000000';

    private const ORGANIZATION = '29000000-0000-4000-8000-000000000001';

    private BillingAccount $account;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        config(['devices.runtime_token' => self::TOKEN, 'devices.runtime_url' => 'http://runtime:8081']);
        Queue::fake();
        // The organization exists from the start of November, so its hours are covered.
        $this->travelTo(CarbonImmutable::parse('2026-11-01 00:00:00', 'UTC'));
        $this->account = BillingAccount::factory()->create(['name' => 'Integrator Billing']);
        $this->organization = Organization::factory()->forBillingAccount($this->account)->create(['uuid' => self::ORGANIZATION, 'name' => 'Lakeside Home']);
        $this->travelTo(CarbonImmutable::parse('2026-11-07 20:41:00', 'UTC'));
    }

    public function test_the_runtimes_fixture_is_accepted_and_counted(): void
    {
        $fixture = json_decode((string) file_get_contents(base_path('../../contracts/internal/events/usage.data_points.v1.fixture.json')), true);

        $this->send($fixture)->assertOk()->assertExactJson(['ok' => true]);

        $this->assertSame([159234, 0], $this->usage('2026-11-01'));
        $this->assertSame([['organization_uuid' => self::ORGANIZATION, 'organization_id' => $this->organization->id, 'count' => 159234]], $this->shares());
        $this->assertSame('2026-11-07T20:00:00Z', CarbonImmutable::parse((string) DB::table('billing_usage_watermarks')->value('final_through'))->utc()->toIso8601ZuluString());
    }

    public function test_replays_lower_counts_and_reports_out_of_order_end_at_the_highest_count(): void
    {
        $hour = '2026-11-07T20:00:00Z';
        $report = $this->report([[self::ORGANIZATION, $hour, 100]]);
        $this->send($report)->assertOk();
        // The same report again under its own id stops at the inbox; under a new id it adds nothing.
        $this->send($report)->assertOk()->assertJsonPath('duplicate', true);
        $this->send([...$report, 'uuid' => (string) Str::uuid()])->assertOk();
        $this->send($this->report([[self::ORGANIZATION, $hour, 80]]))->assertOk();
        $this->send($this->report([[self::ORGANIZATION, $hour, 150]]))->assertOk();
        $this->send($this->report([[self::ORGANIZATION, $hour, 120]]))->assertOk();

        $this->assertSame([150, 0], $this->usage('2026-11-01'));
        $this->assertSame(150, (int) DB::table('billing_data_point_buckets')->value('count'));
    }

    public function test_readings_past_the_allowance_are_overage(): void
    {
        app(Allowances::class)->override($this->account, AllowanceKind::DataPoints, 1000, 'Test allowance', User::factory()->create());

        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T19:00:00Z', 700]]))->assertOk();
        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 500]]))->assertOk();

        $this->assertSame([1200, 200], $this->usage('2026-11-01'));
        $this->assertSame([['plan_assignment_id' => null, 'quantity' => 200]], DB::table('billing_overage')->where('kind', 'data_points')->get(['plan_assignment_id', 'quantity'])
            ->map(fn (object $row): array => ['plan_assignment_id' => $row->plan_assignment_id, 'quantity' => (int) $row->quantity])->all());
    }

    public function test_owners_are_warned_at_80_and_100_percent_of_the_data_point_allowance_once_a_month(): void
    {
        $owner = User::factory()->create();
        $this->account->owners()->attach($owner->id, ['created_at' => now()]);
        app(Allowances::class)->override($this->account, AllowanceKind::DataPoints, 1000, 'Test allowance', User::factory()->create());
        $notices = fn (): array => DB::table('billing_notices')->where('billing_account_id', $this->account->id)->orderBy('key')->pluck('key')->all();

        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T19:00:00Z', 799]]))->assertOk();
        $this->assertSame([], $notices());
        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T19:00:00Z', 800]]))->assertOk();
        $this->assertSame(['data_points:2026-11:80'], $notices());
        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 150]]))->assertOk();
        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 200]]))->assertOk();
        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 900]]))->assertOk();

        $this->assertSame(['data_points:2026-11:100', 'data_points:2026-11:80'], $notices());
        Queue::assertPushed(DeliverBillingEmail::class, 2);
        Queue::assertPushed(DeliverBillingEmail::class, fn (DeliverBillingEmail $job): bool => $job->mail instanceof UsageThresholdMail
            && [$job->mail->kind, $job->mail->percent, $job->mail->count, $job->mail->allowance] === ['data_points', 100, 1000, 1000]);
    }

    public function test_each_hour_counts_for_the_account_the_organization_was_on_then(): void
    {
        $other = BillingAccount::factory()->create(['name' => 'New Billing']);
        $this->travelTo(CarbonImmutable::parse('2026-11-05 12:00:00', 'UTC'));
        app(BillingAccounts::class)->move($this->organization, $other, User::factory()->create(['is_super_admin' => true]));
        $this->travelTo(CarbonImmutable::parse('2026-11-07 20:41:00', 'UTC'));

        $this->send($this->report([
            [self::ORGANIZATION, '2026-11-05T10:00:00Z', 10],
            [self::ORGANIZATION, '2026-11-05T14:00:00Z', 20],
        ]))->assertOk();

        $this->assertSame([10, 0], $this->usage('2026-11-01'));
        $this->assertSame([20, 0], $this->usage('2026-11-01', $other));
    }

    public function test_the_watermark_only_moves_forward_and_tells_when_a_month_is_final(): void
    {
        $this->send($this->report([], '2026-11-07T20:00:00Z'))->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-07 20:42:00', 'UTC'));
        $this->send($this->report([], '2026-11-07T18:00:00Z'))->assertOk();

        $watermark = DB::table('billing_usage_watermarks')->sole();
        $this->assertSame('2026-11-07T20:00:00Z', CarbonImmutable::parse((string) $watermark->final_through)->utc()->toIso8601ZuluString());
        $this->assertSame('2026-11-07T20:42:00Z', CarbonImmutable::parse((string) $watermark->reported_at)->utc()->toIso8601ZuluString());

        $admin = User::factory()->create(['is_super_admin' => true]);
        $dataPoints = fn (string $month): array => collect($this->actingAs($admin, 'sanctum')->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage?month='.$month)->assertOk()->json('data'))->firstWhere('kind', 'data_points');
        $this->assertSame([false, '2026-11-07T20:42:00Z', false, 300], [$dataPoints('2026-11')['final'], $dataPoints('2026-11')['reported_at'], $dataPoints('2026-11')['stale'], $dataPoints('2026-11')['stale_after_seconds']]);
        $this->assertTrue($dataPoints('2026-10')['final']);

        // Ten minutes without a report: the open month is stale.
        $this->travelTo(CarbonImmutable::parse('2026-11-07 20:52:00', 'UTC'));
        $this->assertTrue($dataPoints('2026-11')['stale']);
        // Once the watermark passes the month's end, it is final.
        $this->send($this->report([], '2026-12-01T00:00:00Z'))->assertOk();
        $this->assertSame([true, false], [$dataPoints('2026-11')['final'], $dataPoints('2026-11')['stale']]);
    }

    public function test_reports_held_back_by_an_hour_long_outage_count_exactly_and_read_as_late(): void
    {
        // The runtime reports every minute while the control plane is down for an hour...
        $reports = [];
        foreach (range(1, 60) as $minute) {
            $generated = CarbonImmutable::parse('2026-11-07 20:00', 'UTC')->addMinutes($minute)->toIso8601ZuluString();
            $reports[] = $this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', $minute * 100]], '2026-11-07T20:00:00Z', $generated);
        }

        // ...and the reports arrive together half an hour after the last, out of order.
        $this->travelTo(CarbonImmutable::parse('2026-11-07 21:30', 'UTC'));
        usort($reports, fn (array $a, array $b): int => ($a['payload']['buckets'][0]['count'] * 7 % 6000) <=> ($b['payload']['buckets'][0]['count'] * 7 % 6000));
        foreach ($reports as $report) {
            $this->send($report)->assertOk();
        }

        $this->assertSame([6000, 0], $this->usage('2026-11-01'));
        // Last reported when the runtime built its newest report, not when it arrived (FR-014, SC-005).
        $admin = User::factory()->create(['is_super_admin' => true]);
        $dataPoints = collect($this->actingAs($admin, 'sanctum')->getJson('/api/v1/admin/billing-accounts/'.$this->account->uuid.'/usage')->assertOk()->json('data'))->firstWhere('kind', 'data_points');
        $this->assertSame(['2026-11-07T21:00:00Z', true], [$dataPoints['reported_at'], $dataPoints['stale']]);

        // An older report arriving later never moves it back; a report claiming the future is taken as now.
        $this->send($this->report([], '2026-11-07T20:00:00Z', '2026-11-07T20:30:00Z'))->assertOk();
        $this->send($this->report([], '2026-11-07T20:00:00Z', '2026-11-07T22:00:00Z'))->assertOk();
        $this->assertSame('2026-11-07T21:30:00Z', CarbonImmutable::parse((string) DB::table('billing_usage_watermarks')->value('reported_at'))->utc()->toIso8601ZuluString());
    }

    public function test_a_deleted_organizations_late_report_still_counts_in_its_share(): void
    {
        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 10]]))->assertOk();
        // Deleted for good: only its billing account assignments remember it.
        DB::table('organizations')->where('id', $this->organization->id)->delete();

        $this->send($this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 25]]))->assertOk();

        $this->assertSame([25, 0], $this->usage('2026-11-01'));
        $share = DB::table('billing_usage_shares')->where('kind', 'data_points')->sole();
        $this->assertSame([self::ORGANIZATION, 'Lakeside Home', 25, null], [$share->organization_uuid, $share->organization_name, (int) $share->count, $share->organization_id]);
    }

    public function test_a_late_report_for_last_month_is_priced_against_last_months_plan(): void
    {
        $admin = User::factory()->create(['is_super_admin' => true]);
        app(PlanAssignments::class)->assign($this->account, BillingPlan::factory()->withAllowances(['data_points' => 100])->create(), $admin);
        $this->travelTo(CarbonImmutable::parse('2026-12-01 00:00:30', 'UTC'));
        app(PlanAssignments::class)->assign($this->account, BillingPlan::factory()->withAllowances(['data_points' => 1000])->create(), $admin);

        // November's last hour is reported after midnight, once December's plan is in force.
        $this->send($this->report([[self::ORGANIZATION, '2026-11-30T23:00:00Z', 150]], '2026-12-01T00:00:00Z'))->assertOk();

        $this->assertSame([150, 50], $this->usage('2026-11-01'));
    }

    public function test_another_schema_version_fails_permanently(): void
    {
        $report = $this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 10]]);
        $report['payload']['schema_version'] = 2;

        $this->send($report, assert: false)->assertUnprocessable();

        $this->assertSame(0, DB::table('billing_data_point_buckets')->count());
    }

    public function test_an_unknown_organization_is_recorded_and_not_counted(): void
    {
        $unknown = (string) Str::uuid();

        $this->send($this->report([[$unknown, '2026-11-07T20:00:00Z', 40]]))->assertOk();

        $this->assertSame([[null, 40]], DB::table('billing_data_point_buckets')->get()->map(fn (object $row): array => [$row->billing_account_id, (int) $row->count])->all());
        $this->assertSame(0, DB::table('billing_usage')->count());
    }

    public function test_reports_arrive_in_runtime_batches_with_other_events(): void
    {
        $bad = $this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 99]]);
        $bad['payload']['schema_version'] = 2;
        $events = [
            ['uuid' => (string) Str::uuid(), 'type' => 'runtime.heartbeat.v1', 'payload' => ['at' => '2026-11-07T20:41:00Z']],
            $this->report([[self::ORGANIZATION, '2026-11-07T20:00:00Z', 30]]),
            $bad,
        ];

        $this->withToken(self::TOKEN)->postJson('/api/internal/devices/events/batch', ['events' => $events])
            ->assertOk()
            ->assertJsonPath('results.0.status', 200)
            ->assertJsonPath('results.1.status', 200)
            ->assertJsonPath('results.2.status', 422);

        $this->assertSame([30, 0], $this->usage('2026-11-01'));
    }

    /**
     * @param  list<array{0: string, 1: string, 2: int}>  $buckets  organization uuid, hour, cumulative count
     * @return array{uuid: string, type: string, payload: array<string, mixed>}
     */
    private function report(array $buckets, string $finalThrough = '2026-11-07T20:00:00Z', ?string $generatedAt = null): array
    {
        return ['uuid' => (string) Str::uuid(), 'type' => self::EVENT, 'payload' => [
            'schema_version' => 1,
            'generated_at' => $generatedAt ?? now()->utc()->toIso8601ZuluString(),
            'final_through' => $finalThrough,
            'buckets' => array_map(fn (array $bucket): array => [
                'organization_uuid' => $bucket[0],
                'hour' => $bucket[1],
                'count' => $bucket[2],
                'final' => CarbonImmutable::parse($bucket[1])->addHour()->lessThanOrEqualTo(CarbonImmutable::parse($finalThrough)),
            ], $buckets),
        ]];
    }

    private function send(array $envelope, bool $assert = true): TestResponse
    {
        if ($assert) {
            // What these tests send is what the runtime may send.
            $this->assertProduced(self::EVENT, $envelope);
        }

        return $this->withToken(self::TOKEN)->postJson('/api/internal/devices/events', $envelope);
    }

    /**
     * @return array{0: int, 1: int} count and overage
     */
    private function usage(string $month, ?BillingAccount $account = null): array
    {
        $row = DB::table('billing_usage')->where('billing_account_id', ($account ?? $this->account)->id)->where('kind', 'data_points')->where('month', $month)->first();

        return [(int) $row?->count, (int) $row?->overage];
    }

    /**
     * @return list<array{organization_uuid: string, organization_id: int, count: int}>
     */
    private function shares(): array
    {
        return DB::table('billing_usage_shares')->where('kind', 'data_points')->get()
            ->map(fn (object $share): array => ['organization_uuid' => $share->organization_uuid, 'organization_id' => (int) $share->organization_id, 'count' => (int) $share->count])
            ->all();
    }
}
