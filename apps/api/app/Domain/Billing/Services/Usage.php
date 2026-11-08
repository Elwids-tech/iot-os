<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Contracts\SmsAllowance;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use stdClass;

/**
 * Exact monthly usage per billing account, with each organization's share (spec 028
 * US3 and US4, research R5, ADR-035). Every write locks the account's row for the kind
 * and month, so concurrent counts serialize. Overage, the part beyond the allowance at
 * that moment, is fixed when counted and recorded against the plan assignment in force:
 * a later allowance change only moves what is left. Counting never stops an alert; SMS
 * is reserved instead, and refused once it no longer fits.
 */
final class Usage implements SmsAllowance
{
    /** The monthly kinds counted, in display order. Data points come from the runtime's reports. */
    public const COUNTED = [AllowanceKind::Alerts, AllowanceKind::Sms, AllowanceKind::DataPoints];

    public function __construct(
        private readonly Allowances $allowances,
        private readonly PlanAssignments $assignments,
        private readonly UsageThresholds $thresholds,
        private readonly DeviceLimit $devices,
    ) {}

    /**
     * Counts `$quantity` in the UTC month of `$at`, recording what goes past the allowance
     * as overage. Threshold emails are checked once the caller's transaction commits.
     *
     * @return array{count: int, overage: int} the account's totals for the month after it
     */
    public function add(BillingAccount $account, ?Organization $organization, AllowanceKind $kind, CarbonImmutable $at, int $quantity): array
    {
        self::assertCounted($kind, $quantity);
        $month = self::monthOf($at);

        [$count, $overage, $allowance] = DB::transaction(function () use ($account, $organization, $kind, $at, $quantity, $month): array {
            $totals = $this->lock($account, $kind, $month);
            $allowance = $this->allowances->value($account->withoutRelations(), $kind);
            $count = (int) $totals->count + $quantity;
            $delta = $allowance === null ? 0 : max(0, min($quantity, $count - $allowance));
            $overage = (int) $totals->overage + $delta;

            $this->write($account, $organization, $kind, $month, $count, $overage, $quantity);

            if ($delta > 0) {
                $this->recordOverage($account, $kind, $month, $this->assignments->at($account, $at)?->getKey(), $delta);
            }

            return [$count, $overage, $allowance];
        });

        DB::afterCommit(fn () => $this->thresholds->check($account, $kind, $month, $count, $allowance));

        return ['count' => $count, 'overage' => $overage];
    }

    public function reserve(BillingAccount $account, Organization $organization, int $parts, CarbonImmutable $at): bool
    {
        self::assertCounted(AllowanceKind::Sms, $parts);
        $month = self::monthOf($at);

        $reserved = DB::transaction(function () use ($account, $organization, $parts, $month): ?array {
            $totals = $this->lock($account, AllowanceKind::Sms, $month);
            $allowance = $this->allowances->value($account->withoutRelations(), AllowanceKind::Sms);
            $count = (int) $totals->count + $parts;

            if ($allowance !== null && $count > $allowance) {
                return null;
            }

            $this->write($account, $organization, AllowanceKind::Sms, $month, $count, (int) $totals->overage, $parts);

            return [$count, $allowance];
        });

        if ($reserved === null) {
            return false;
        }

        DB::afterCommit(fn () => $this->thresholds->check($account, AllowanceKind::Sms, $month, $reserved[0], $reserved[1]));

        return true;
    }

    public function release(BillingAccount $account, Organization $organization, int $parts, CarbonImmutable $reservedAt): void
    {
        self::assertCounted(AllowanceKind::Sms, $parts);
        $month = self::monthOf($reservedAt);

        DB::transaction(function () use ($account, $organization, $parts, $month): void {
            $totals = DB::table('billing_usage')->where(self::key($account, AllowanceKind::Sms, $month))->lockForUpdate()->first();

            if ($totals === null) {
                return;
            }

            $this->write($account, $organization, AllowanceKind::Sms, $month, max(0, (int) $totals->count - $parts), (int) $totals->overage, -$parts);
        });
    }

    /**
     * The account's usage of each counted kind in a month, with each organization's share,
     * then its devices.
     *
     * @return list<MonthlyUsage>
     */
    public function forAccount(BillingAccount $account, CarbonImmutable $month, bool $withSms = true): array
    {
        $kinds = self::kinds($withSms);
        $start = self::monthOf($month);
        $totals = DB::table('billing_usage')
            ->where('billing_account_id', $account->getKey())
            ->where('month', $start)
            ->whereIn('kind', self::values($kinds))
            ->get()
            ->keyBy('kind');
        $shares = DB::table('billing_usage_shares')
            ->where('billing_account_id', $account->getKey())
            ->where('month', $start)
            ->whereIn('kind', self::values($kinds))
            ->orderBy('organization_name')
            ->orderBy('organization_uuid')
            ->get()
            ->groupBy('kind');
        $allowances = $this->allowances->all($account);
        $reports = $this->dataPointReports(CarbonImmutable::parse($start, 'UTC'));

        return [...array_map(fn (AllowanceKind $kind): MonthlyUsage => new MonthlyUsage(
            $kind,
            CarbonImmutable::parse($start, 'UTC'),
            (int) ($totals->get($kind->value)->count ?? 0),
            $allowances[$kind->value]->value,
            (int) ($totals->get($kind->value)->overage ?? 0),
            ($shares->get($kind->value) ?? collect())
                ->map(fn (stdClass $share): array => [
                    'organization_uuid' => (string) $share->organization_uuid,
                    'name' => (string) $share->organization_name,
                    'count' => (int) $share->count,
                ])
                ->values()
                ->all(),
            ...($kind === AllowanceKind::DataPoints ? $reports : []),
        ), $kinds), $this->deviceUsage($account, $month, $allowances[AllowanceKind::Devices->value]->value)];
    }

    /**
     * Devices are a level: this month shows the devices holding a place now and each
     * organization's; an earlier month shows its peak.
     */
    private function deviceUsage(BillingAccount $account, CarbonImmutable $month, ?int $allowance): MonthlyUsage
    {
        $start = CarbonImmutable::parse(self::monthOf($month), 'UTC');
        $peak = $this->devices->peak($account, $start);

        if (self::monthOf($month) !== self::monthOf(CarbonImmutable::now())) {
            return new MonthlyUsage(AllowanceKind::Devices, $start, $peak, $allowance, 0, [], peak: $peak);
        }

        $now = $this->devices->count($account);

        return new MonthlyUsage(AllowanceKind::Devices, $start, $now['total'], $allowance, 0, $now['organizations'], peak: max($peak, $now['total']));
    }

    /**
     * How far the runtime's data point reports cover a month (spec 029 FR-014): final once
     * its watermark passed the month's end, and stale when an open month has not been
     * reported for longer than `billing.usage_report_stale_seconds`.
     *
     * @return array{final: bool, reportedAt: ?CarbonImmutable, stale: bool}
     */
    private function dataPointReports(CarbonImmutable $month): array
    {
        $watermark = DB::table('billing_usage_watermarks')->where('source', DataPointReports::SOURCE)->first();
        $reportedAt = $watermark === null ? null : CarbonImmutable::parse((string) $watermark->reported_at)->utc();
        $final = $watermark !== null && CarbonImmutable::parse((string) $watermark->final_through)->greaterThanOrEqualTo($month->addMonthNoOverflow());
        $stale = ! $final && ($reportedAt === null || $reportedAt->lessThan(CarbonImmutable::now()->subSeconds((int) config('billing.usage_report_stale_seconds'))));

        return ['final' => $final, 'reportedAt' => $reportedAt, 'stale' => $stale];
    }

    /**
     * What a manager of the organization sees (spec 028 FR-022): its own count, and the
     * allowance, what is left and the overage of its billing account, without the
     * account's other organizations.
     *
     * @return list<OrganizationUsage>
     */
    public function forOrganization(Organization $organization, CarbonImmutable $month, bool $withSms = true): array
    {
        $account = $organization->billingAccount;

        if ($account === null) {
            return [];
        }

        $start = self::monthOf($month);
        $counts = DB::table('billing_usage_shares')
            ->where('billing_account_id', $account->getKey())
            ->where('organization_uuid', $organization->uuid)
            ->where('month', $start)
            ->pluck('count', 'kind');

        return array_map(
            fn (MonthlyUsage $usage): OrganizationUsage => new OrganizationUsage(
                $usage->kind === AllowanceKind::Devices
                    ? (int) (collect($usage->organizations)->firstWhere('organization_uuid', $organization->uuid)['count'] ?? 0)
                    : (int) ($counts[$usage->kind->value] ?? 0),
                new MonthlyUsage($usage->kind, $usage->month, $usage->count, $usage->allowance, $usage->overage, final: $usage->final, reportedAt: $usage->reportedAt, stale: $usage->stale),
            ),
            $this->forAccount($account, $month, $withSms),
        );
    }

    /**
     * Narrows a billing account query to accounts that have used at least `$percent` of
     * a limited allowance in the month of `$at`, or whose devices holding a place now
     * reach that share of the device limit (spec 028 FR-020, spec 029 FR-026). The
     * allowance is resolved in SQL as `Allowances` does: override, plan, default.
     *
     * @param  Builder<BillingAccount>  $query
     * @return Builder<BillingAccount>
     */
    public function whereUsageAtLeast(Builder $query, int $percent, CarbonImmutable $at): Builder
    {
        $allowance = self::allowanceSql('billing_usage.kind', self::COUNTED);
        $deviceLimit = '(SELECT '.self::allowanceSql("'devices'", [AllowanceKind::Devices], 'billing_accounts.id').')';
        $devices = '(SELECT count(*) FROM devices JOIN organizations ON organizations.id = devices.organization_id'
            .' WHERE organizations.billing_account_id = billing_accounts.id AND organizations.deleted_at IS NULL AND devices.limit_place_at IS NOT NULL)';

        return $query->where(fn (Builder $query) => $query
            ->whereExists(fn ($usage) => self::joinAllowance($usage->selectRaw('1')->from('billing_usage'), 'billing_usage.kind', 'billing_usage.billing_account_id')
                ->whereColumn('billing_usage.billing_account_id', 'billing_accounts.id')
                ->where('billing_usage.month', self::monthOf($at))
                ->whereIn('billing_usage.kind', self::values(self::COUNTED))
                ->where('billing_usage.count', '>', 0)
                ->whereRaw("({$allowance}) IS NOT NULL")
                // count >= ceil(allowance × percent / 100), in whole numbers.
                ->whereRaw("billing_usage.count * 100 >= ? * ({$allowance})", [$percent]))
            ->orWhere(fn (Builder $query) => $query
                ->whereRaw("{$devices} > 0")
                ->whereRaw("{$deviceLimit} IS NOT NULL")
                ->whereRaw("{$devices} * 100 >= ? * {$deviceLimit}", [$percent])));
    }

    /**
     * The allowance of `$kindSql` resolved in SQL, from the joins `joinAllowance` adds:
     * the override, else the plan's, else the deployment default. With `$accountSql`, it
     * is a scalar subquery body that makes its own joins for that account.
     *
     * @param  list<AllowanceKind>  $kinds  the kinds `$kindSql` can be, for their defaults
     */
    private static function allowanceSql(string $kindSql, array $kinds, ?string $accountSql = null): string
    {
        $defaults = (array) config('billing.defaults');
        $default = "CASE {$kindSql}";

        foreach ($kinds as $kind) {
            $value = $defaults[$kind->value] ?? null;
            $default .= sprintf(" WHEN '%s' THEN CAST(%s AS BIGINT)", $kind->value, $value === null ? 'NULL' : (int) $value);
        }

        $case = 'CASE WHEN billing_allowance_overrides.kind IS NOT NULL THEN billing_allowance_overrides.value'
            .' WHEN billing_plan_allowances.kind IS NOT NULL THEN billing_plan_allowances.value'
            ." ELSE {$default} END END";

        if ($accountSql === null) {
            return $case;
        }

        return "{$case} FROM billing_accounts AS allowance_account"
            ." LEFT JOIN billing_allowance_overrides ON billing_allowance_overrides.billing_account_id = allowance_account.id AND billing_allowance_overrides.kind = {$kindSql}"
            .' LEFT JOIN billing_plan_assignments ON billing_plan_assignments.billing_account_id = allowance_account.id AND billing_plan_assignments.ended_at IS NULL'
            ." LEFT JOIN billing_plan_allowances ON billing_plan_allowances.billing_plan_id = billing_plan_assignments.billing_plan_id AND billing_plan_allowances.kind = {$kindSql}"
            ." WHERE allowance_account.id = {$accountSql}";
    }

    private static function joinAllowance(QueryBuilder $query, string $kindColumn, string $accountColumn): QueryBuilder
    {
        return $query
            ->leftJoin('billing_allowance_overrides', fn (JoinClause $join) => $join
                ->on('billing_allowance_overrides.billing_account_id', '=', $accountColumn)
                ->on('billing_allowance_overrides.kind', '=', $kindColumn))
            ->leftJoin('billing_plan_assignments', fn (JoinClause $join) => $join
                ->on('billing_plan_assignments.billing_account_id', '=', $accountColumn)
                ->whereNull('billing_plan_assignments.ended_at'))
            ->leftJoin('billing_plan_allowances', fn (JoinClause $join) => $join
                ->on('billing_plan_allowances.billing_plan_id', '=', 'billing_plan_assignments.billing_plan_id')
                ->on('billing_plan_allowances.kind', '=', $kindColumn));
    }

    /**
     * Whether the deployment can send SMS (spec 011: a Twilio account and a sender). Without
     * it, owners and managers see no SMS allowance or usage (spec 028 edge case "SMS not
     * configured"); platform administrators still do.
     */
    public static function smsAvailable(): bool
    {
        return filled(config('services.twilio.account_sid')) && filled(config('services.twilio.from'));
    }

    /** The first day of the UTC month `$at` falls in, as stored. */
    public static function monthOf(CarbonImmutable $at): string
    {
        return $at->utc()->startOfMonth()->toDateString();
    }

    /**
     * Inserts the month's row if needed, then locks it.
     */
    private function lock(BillingAccount $account, AllowanceKind $kind, string $month): stdClass
    {
        $key = self::key($account, $kind, $month);
        DB::table('billing_usage')->insertOrIgnore([...$key, 'count' => 0, 'overage' => 0, 'updated_at' => now()]);

        /** @var stdClass */
        return DB::table('billing_usage')->where($key)->lockForUpdate()->first();
    }

    /**
     * Writes the totals and moves the organization's share by `$shareDelta`. Shares are
     * only written under the totals lock, so they need no lock of their own.
     */
    private function write(BillingAccount $account, ?Organization $organization, AllowanceKind $kind, string $month, int $count, int $overage, int $shareDelta): void
    {
        DB::table('billing_usage')
            ->where(self::key($account, $kind, $month))
            ->update(['count' => $count, 'overage' => $overage, 'updated_at' => now()]);

        if ($organization === null) {
            return;
        }

        $key = [...self::key($account, $kind, $month), 'organization_uuid' => $organization->uuid];
        $share = DB::table('billing_usage_shares')->where($key)->value('count');

        if ($share === null) {
            if ($shareDelta > 0) {
                DB::table('billing_usage_shares')->insert([
                    ...$key,
                    'organization_id' => $organization->getKey(),
                    'organization_name' => $organization->name,
                    'count' => $shareDelta,
                ]);
            }

            return;
        }

        DB::table('billing_usage_shares')->where($key)->update([
            'organization_id' => $organization->getKey(),
            'organization_name' => $organization->name,
            'count' => max(0, (int) $share + $shareDelta),
        ]);
    }

    private function recordOverage(BillingAccount $account, AllowanceKind $kind, string $month, ?int $assignmentId, int $quantity): void
    {
        $updated = DB::table('billing_overage')
            ->where(self::key($account, $kind, $month))
            ->when(
                $assignmentId === null,
                fn ($query) => $query->whereNull('plan_assignment_id'),
                fn ($query) => $query->where('plan_assignment_id', $assignmentId),
            )
            ->increment('quantity', $quantity);

        if ($updated === 0) {
            DB::table('billing_overage')->insert([
                ...self::key($account, $kind, $month),
                'plan_assignment_id' => $assignmentId,
                'quantity' => $quantity,
            ]);
        }
    }

    /**
     * @return array{billing_account_id: int, kind: string, month: string}
     */
    private static function key(BillingAccount $account, AllowanceKind $kind, string $month): array
    {
        return ['billing_account_id' => (int) $account->getKey(), 'kind' => $kind->value, 'month' => $month];
    }

    private static function assertCounted(AllowanceKind $kind, int $quantity): void
    {
        if (! $kind->isMonthly() || $quantity < 1) {
            throw new InvalidArgumentException(sprintf('Usage counts a positive quantity of a monthly kind, not %d %s.', $quantity, $kind->value));
        }
    }

    /**
     * @return list<AllowanceKind>
     */
    private static function kinds(bool $withSms): array
    {
        return array_values(array_filter(self::COUNTED, fn (AllowanceKind $kind): bool => $withSms || $kind !== AllowanceKind::Sms));
    }

    /**
     * @param  list<AllowanceKind>  $kinds
     * @return list<string>
     */
    private static function values(array $kinds): array
    {
        return array_map(fn (AllowanceKind $kind): string => $kind->value, $kinds);
    }
}
