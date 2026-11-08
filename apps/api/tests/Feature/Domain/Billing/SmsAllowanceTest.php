<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use App\Domain\Billing\Contracts\SmsAllowance;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\Usage;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;
use Throwable;

/**
 * SMS parts are reserved in the billing account's SMS allowance before the provider is
 * asked, refused once they no longer fit, and released when the provider refuses the
 * message (spec 028 FR-013, FR-015, FR-016, SC-002). SMS never records overage.
 */
final class SmsAllowanceTest extends TestCase
{
    use RefreshDatabase;

    private BillingAccount $account;

    private Organization $organization;

    private SmsAllowance $sms;

    protected function setUp(): void
    {
        parent::setUp();
        $this->account = BillingAccount::factory()->create();
        $this->organization = Organization::factory()->forBillingAccount($this->account)->create();
        $this->sms = app(SmsAllowance::class);
    }

    public function test_the_sender_reaches_usage_through_the_interface(): void
    {
        $this->assertInstanceOf(Usage::class, $this->sms);
    }

    public function test_parts_are_reserved_within_and_at_the_allowance_and_refused_over_it(): void
    {
        $this->allow(3);
        $now = CarbonImmutable::now();

        $this->assertTrue($this->sms->reserve($this->account, $this->organization, 2, $now));
        // Two parts do not fit in the one that is left.
        $this->assertFalse($this->sms->reserve($this->account, $this->organization, 2, $now));
        $this->assertTrue($this->sms->reserve($this->account, $this->organization, 1, $now));
        $this->assertFalse($this->sms->reserve($this->account, $this->organization, 1, $now));

        $this->assertSame([3, 0], $this->totals());
        $this->assertSame(3, $this->share());
        $this->assertSame(0, DB::table('billing_overage')->count());
    }

    public function test_an_allowance_of_zero_refuses_everything_and_unlimited_refuses_nothing(): void
    {
        $now = CarbonImmutable::now();
        // The deployment default is 0 unless the operator sets one.
        config(['billing.defaults.sms' => 0]);
        $this->assertFalse($this->sms->reserve($this->account, $this->organization, 1, $now));

        app(Allowances::class)->override($this->account, AllowanceKind::Sms, null, 'Unlimited for the pilot', User::factory()->create());
        $this->assertTrue($this->sms->reserve($this->account, $this->organization, 500, $now));
        $this->assertSame([500, 0], $this->totals());
    }

    public function test_release_gives_parts_back_and_never_goes_below_zero(): void
    {
        $this->allow(5);
        $now = CarbonImmutable::now();
        $this->sms->reserve($this->account, $this->organization, 3, $now);

        $this->sms->release($this->account, $this->organization, 2, $now);
        $this->assertSame([1, 0], $this->totals());
        $this->assertSame(1, $this->share());

        $this->sms->release($this->account, $this->organization, 4, $now);
        $this->assertSame([0, 0], $this->totals());
        $this->assertSame(0, $this->share());

        // A month with nothing reserved has nothing to give back.
        $this->sms->release($this->account, $this->organization, 1, $now->subMonthNoOverflow());
        $this->assertSame(1, DB::table('billing_usage')->count());
    }

    public function test_a_release_after_the_month_turned_goes_back_to_the_month_it_was_reserved_in(): void
    {
        $this->allow(1);
        $reservedAt = CarbonImmutable::parse('2026-11-30 23:59:59', 'UTC');
        $this->assertTrue($this->sms->reserve($this->account, $this->organization, 1, $reservedAt));

        $this->travelTo(CarbonImmutable::parse('2026-12-01 00:00:05', 'UTC'));
        $this->sms->release($this->account, $this->organization, 1, $reservedAt);

        $this->assertSame([0, 0], $this->totals('2026-11-01'));
    }

    /**
     * 100 reservations of one part each, from 50 processes on their own connections,
     * against an allowance of 37: exactly 37 go through (028 SC-002). Row locks need
     * PostgreSQL, and the rows must be committed for the other connections to see them.
     */
    public function test_concurrent_reservations_never_exceed_the_allowance(): void
    {
        if (DB::getDriverName() !== 'pgsql' || ! function_exists('pcntl_fork')) {
            $this->markTestSkipped('Needs PostgreSQL row locks and pcntl.');
        }

        $processes = 50;
        $perProcess = 2;
        $allowance = 37;
        $base = config('database.connections.'.config('database.default'));
        config(['database.connections.billing_setup' => $base, 'database.connections.billing_child' => $base]);
        $setup = DB::connection('billing_setup');
        $results = sys_get_temp_dir().'/sms-allowance-'.Str::uuid();
        mkdir($results);
        $now = now();
        $accountId = $setup->table('billing_accounts')->insertGetId(['uuid' => (string) Str::uuid(), 'name' => 'Concurrent SMS', 'created_at' => $now, 'updated_at' => $now]);
        $organizationId = $setup->table('organizations')->insertGetId(['uuid' => (string) Str::uuid(), 'name' => 'Concurrent SMS', 'slug' => 'concurrent-sms-'.Str::lower(Str::random(6)), 'billing_account_id' => $accountId, 'created_at' => $now, 'updated_at' => $now]);
        $setup->table('billing_allowance_overrides')->insert(['billing_account_id' => $accountId, 'kind' => 'sms', 'value' => $allowance, 'note' => 'Concurrency test', 'created_at' => $now, 'updated_at' => $now]);
        $setup->disconnect();

        try {
            $start = microtime(true) + 1.0;
            $children = [];

            for ($i = 0; $i < $processes; $i++) {
                $pid = pcntl_fork();

                if ($pid === 0) {
                    $this->reserveInChild($results.'/'.$i, $accountId, $organizationId, $perProcess, $start);
                }

                $children[] = $pid;
            }

            foreach ($children as $pid) {
                pcntl_waitpid($pid, $status);
            }

            $outcomes = array_map(fn (int $i): string => (string) @file_get_contents($results.'/'.$i), range(0, $processes - 1));
            $reserved = array_sum(array_map(fn (string $outcome): int => substr_count($outcome, 'y'), $outcomes));
            $refused = array_sum(array_map(fn (string $outcome): int => substr_count($outcome, 'n'), $outcomes));

            $this->assertSame([], array_values(array_filter($outcomes, fn (string $outcome): bool => str_starts_with($outcome, 'error'))));
            $this->assertSame([$allowance, $processes * $perProcess - $allowance], [$reserved, $refused]);
            $totals = DB::table('billing_usage')->where('billing_account_id', $accountId)->where('kind', 'sms')->sole();
            $this->assertSame([$allowance, 0], [(int) $totals->count, (int) $totals->overage]);
            $this->assertSame($allowance, (int) DB::table('billing_usage_shares')->where('billing_account_id', $accountId)->value('count'));
        } finally {
            $setup->reconnect();
            foreach (['billing_usage_shares', 'billing_usage', 'billing_notices', 'billing_allowance_overrides'] as $table) {
                $setup->table($table)->where('billing_account_id', $accountId)->delete();
            }
            $setup->table('organizations')->where('id', $organizationId)->delete();
            $setup->table('billing_accounts')->where('id', $accountId)->delete();
            $setup->disconnect();
            array_map('unlink', glob($results.'/*') ?: []);
            rmdir($results);
        }
    }

    /**
     * Runs in a forked child: its own connection, the parent's left untouched, and a
     * SIGKILL at the end so no destructor closes the parent's inherited sockets.
     */
    private function reserveInChild(string $file, int $accountId, int $organizationId, int $count, float $start): never
    {
        try {
            DB::setDefaultConnection('billing_child');
            DB::connection('billing_child')->getPdo();
            $account = BillingAccount::query()->findOrFail($accountId);
            $organization = Organization::query()->findOrFail($organizationId);
            $sms = app(SmsAllowance::class);
            time_sleep_until($start);
            $outcome = '';

            for ($i = 0; $i < $count; $i++) {
                $outcome .= $sms->reserve($account, $organization, 1, CarbonImmutable::now()) ? 'y' : 'n';
            }
        } catch (Throwable $exception) {
            $outcome = 'error: '.$exception->getMessage();
        }

        file_put_contents($file, $outcome);
        posix_kill(getmypid(), SIGKILL);

        exit(1);
    }

    private function allow(int $parts): void
    {
        app(Allowances::class)->override($this->account, AllowanceKind::Sms, $parts, 'Test allowance', User::factory()->create());
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function totals(?string $month = null): array
    {
        $row = DB::table('billing_usage')
            ->where('billing_account_id', $this->account->id)
            ->where('kind', 'sms')
            ->where('month', $month ?? Usage::monthOf(CarbonImmutable::now()))
            ->first();

        return [(int) $row?->count, (int) $row?->overage];
    }

    private function share(): int
    {
        return (int) DB::table('billing_usage_shares')
            ->where('billing_account_id', $this->account->id)
            ->where('organization_uuid', $this->organization->uuid)
            ->where('kind', 'sms')
            ->value('count');
    }
}
