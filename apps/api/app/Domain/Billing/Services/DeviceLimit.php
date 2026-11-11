<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Exceptions\DeviceLimitReached;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Active devices per billing account against its device limit (spec 029 US2, research
 * R7). A device holds a place while `limit_place_at` is set: from the moment its
 * activation is accepted until its deactivation is accepted or it is archived. Callers
 * lock the device row first; claiming then locks the account row, so concurrent
 * activations across the account's organizations serialize and never pass the limit.
 * Nothing here deactivates a device: an account over its limit after the limit was
 * lowered, or an organization moved in, only refuses further activations.
 */
final class DeviceLimit
{
    public function __construct(
        private readonly Allowances $allowances,
        private readonly UsageThresholds $thresholds,
    ) {}

    /**
     * Gives the device a place, or refuses at the limit with a 422 on `device` that names
     * the limit and nothing else about the account. A device that already holds a place
     * keeps it, so reconfiguring or rolling back an active device is never refused.
     *
     * @throws DeviceLimitReached
     */
    public function claim(Device $device): void
    {
        if ($device->limit_place_at !== null) {
            return;
        }

        $account = $this->lockAccount($device);
        $limit = $account === null ? null : $this->allowances->value($account->withoutRelations(), AllowanceKind::Devices);
        $count = $account === null ? 0 : $this->placed($account);

        if ($limit !== null && $count >= $limit) {
            throw DeviceLimitReached::withMessages(['device' => self::refusal($limit)]);
        }

        $this->take($device, $account, $count + 1, $limit);
    }

    /**
     * Gives back the device's place when its deactivation is accepted, it is archived, or
     * its first activation failed.
     */
    public function release(Device $device): void
    {
        if ($device->limit_place_at === null) {
            return;
        }

        $account = $this->lockAccount($device);

        if ($account !== null) {
            // The level before the release was reached this month too.
            $this->raisePeak($account, $this->placed($account), CarbonImmutable::now());
        }

        $device->forceFill(['limit_place_at' => null])->save();
    }

    /**
     * Takes a place back without a check, when a deactivation the device's place was
     * released for failed and the device stays active.
     */
    public function retake(Device $device): void
    {
        if ($device->limit_place_at !== null) {
            return;
        }

        $account = $this->lockAccount($device);
        $this->take(
            $device,
            $account,
            $account === null ? 1 : $this->placed($account) + 1,
            $account === null ? null : $this->allowances->value($account->withoutRelations(), AllowanceKind::Devices),
        );
    }

    /**
     * Hands a moved device's place to its successor inside the caller's cutover
     * transaction (spec 031, research R4): both are in one billing account, so the count
     * stays the same, and nothing is claimed, checked or written to the month's peak. A
     * move at the limit is therefore never refused.
     */
    public function transfer(Device $from, Device $to): void
    {
        $to->forceFill(['limit_place_at' => $from->limit_place_at])->save();
        $from->forceFill(['limit_place_at' => null])->save();
    }

    /**
     * The account's devices that hold a place now, in total and per organization by name.
     *
     * @return array{total: int, organizations: list<array{organization_uuid: string, name: string, count: int}>}
     */
    public function count(BillingAccount $account): array
    {
        $organizations = DB::table('devices')
            ->join('organizations', 'organizations.id', '=', 'devices.organization_id')
            ->where('organizations.billing_account_id', $account->getKey())
            ->whereNull('organizations.deleted_at')
            ->whereNotNull('devices.limit_place_at')
            ->groupBy('organizations.uuid', 'organizations.name')
            ->orderBy('organizations.name')
            ->orderBy('organizations.uuid')
            ->selectRaw('organizations.uuid, organizations.name, count(*) as places')
            ->get()
            ->map(fn (object $row): array => [
                'organization_uuid' => (string) $row->uuid,
                'name' => (string) $row->name,
                'count' => (int) $row->places,
            ])
            ->values()
            ->all();

        return ['total' => array_sum(array_column($organizations, 'count')), 'organizations' => $organizations];
    }

    /** The month's highest number of devices with a place, as recorded so far. */
    public function peak(BillingAccount $account, CarbonImmutable $month): int
    {
        return (int) DB::table('billing_device_peaks')
            ->where('billing_account_id', $account->getKey())
            ->where('month', Usage::monthOf($month))
            ->value('peak');
    }

    /**
     * Records every account's current count as at least this month's peak (spec 029
     * FR-007). Claims and releases keep the peak as devices come and go; this catches a
     * month in which none did. Scheduled daily by `billing:device-peaks`.
     */
    public function recordPeaks(CarbonImmutable $at): int
    {
        $rows = Device::query()
            ->join('organizations', 'organizations.id', '=', 'devices.organization_id')
            ->whereNull('organizations.deleted_at')
            ->whereNotNull('devices.limit_place_at')
            ->groupBy('organizations.billing_account_id')
            ->selectRaw('organizations.billing_account_id, count(*) as places')
            ->toBase()
            ->get();

        foreach ($rows as $row) {
            self::upsertPeak((int) $row->billing_account_id, Usage::monthOf($at), (int) $row->places);
        }

        return $rows->count();
    }

    /**
     * After an organization moves or the account's device limit changes: raises the
     * month's peak to the devices holding a place now and checks the warnings at 80% and
     * 100%, which otherwise only an activation would (spec 029 FR-007, FR-025).
     */
    public function recheck(BillingAccount $account): void
    {
        $count = $this->placed($account);
        $at = CarbonImmutable::now();
        $this->raisePeak($account, $count, $at);
        $limit = $this->allowances->value($account->withoutRelations(), AllowanceKind::Devices);
        DB::afterCommit(fn () => $this->thresholds->check($account, AllowanceKind::Devices, Usage::monthOf($at), $count, $limit));
    }

    public static function refusal(int $limit): string
    {
        return sprintf("Your billing account's device limit (%s) is reached. Deactivate a device or contact the platform operator.", number_format($limit));
    }

    private function take(Device $device, ?BillingAccount $account, int $count, ?int $limit): void
    {
        $device->forceFill(['limit_place_at' => now()])->save();

        if ($account === null) {
            return;
        }

        $at = CarbonImmutable::now();
        $this->raisePeak($account, $count, $at);
        // A level: warned once per threshold and month (spec 029 FR-025).
        DB::afterCommit(fn () => $this->thresholds->check($account, AllowanceKind::Devices, Usage::monthOf($at), $count, $limit));
    }

    private function lockAccount(Device $device): ?BillingAccount
    {
        $accountId = Organization::withTrashed()->whereKey($device->organization_id)->value('billing_account_id');

        return $accountId === null ? null : BillingAccount::query()->whereKey($accountId)->lockForUpdate()->first();
    }

    private function placed(BillingAccount $account): int
    {
        return Device::query()
            ->whereNotNull('limit_place_at')
            ->whereIn('organization_id', Organization::query()->select('id')->where('billing_account_id', $account->getKey()))
            ->count();
    }

    private function raisePeak(BillingAccount $account, int $count, CarbonImmutable $at): void
    {
        self::upsertPeak((int) $account->getKey(), Usage::monthOf($at), $count);
    }

    private static function upsertPeak(int $accountId, string $month, int $count): void
    {
        DB::table('billing_device_peaks')->upsert(
            [['billing_account_id' => $accountId, 'month' => $month, 'peak' => $count]],
            ['billing_account_id', 'month'],
            ['peak' => DB::raw('CASE WHEN excluded.peak > billing_device_peaks.peak THEN excluded.peak ELSE billing_device_peaks.peak END')],
        );
    }
}
