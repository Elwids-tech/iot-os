<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Devices\Models\TelemetryRetentionSetting;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Telemetry retention per organization: its own override, else its billing account's
 * retention allowance (a plan or account override, spec 029 US4), else the platform
 * default, else `devices.default_retention_days`. After a billing change shortens it,
 * a floor keeps cleanup at the previous period for 30 days (`RetentionGuard`); a
 * confirmed shorter override set here ends that grace.
 */
final class RetentionService
{
    public function __construct(private readonly Allowances $allowances) {}

    public function inspection(?Organization $organization = null): array
    {
        $last = DB::table('activity_log')->where('event', 'retention.cleanup')
            ->when($organization, fn ($query) => $query->where('organization_id', $organization->id))->latest('id')->first();
        $failures = DB::table('activity_log')->whereIn('id', function ($query): void {
            $query->selectRaw('MAX(id)')->from('activity_log')->where('event', 'retention.cleanup')->groupBy('organization_id');
        })->where('properties->status', 'failed')->when($organization, fn ($query) => $query->where('organization_id', $organization->id))->count();

        return [...$this->effective($organization), 'cleanup' => $last ? ['at' => $last->created_at, ...json_decode($last->properties, true)] : null, 'cleanup_failures' => $failures];
    }

    public function effective(?Organization $organization = null): array
    {
        $platform = TelemetryRetentionSetting::where('scope_key', 'platform')->first();
        $override = $organization ? TelemetryRetentionSetting::where('scope_key', 'organization:'.$organization->uuid)->first() : null;
        $billing = $this->billingDays($organization);
        $platformDays = $platform?->days ?? config('devices.default_retention_days');
        [$days, $source] = match (true) {
            $override?->days !== null => [$override->days, 'organization'],
            $billing !== null => [$billing, 'billing_account'],
            $platform?->days !== null => [$platform->days, 'platform'],
            default => [config('devices.default_retention_days'), 'default'],
        };

        $effective = ['days' => (int) $days,
            'source' => $source,
            'override_days' => $organization ? $override?->days : $platform?->days,
            'revision' => ($organization ? $override?->revision : $platform?->revision) ?? 0,
            'platform_days' => (int) $platformDays,
            // What the platform falls back to without a default of its own.
            'default_days' => (int) config('devices.default_retention_days'),
            // What an organization without its own override gets: its billing account's, else the platform's.
            'billing_days' => $billing,
            'pending_reduction' => $organization ? $this->pendingReduction($organization, (int) $days) : null,
            'cutoff' => now()->subDays((int) $days)->toIso8601String()];
        // What cleanup uses now: longer than `days` while a billing change's grace runs.
        $effective['cleanup_days'] = $organization ? $this->cleanupDays($organization, $effective) : (int) $days;

        return $effective;
    }

    /**
     * The days cleanup uses: the effective period raised to any floor still running, so
     * a billing change shortens it only after its grace (spec 029 FR-020). Sent to the
     * runtime in `/state`.
     */
    public function cleanupDays(Organization $organization, ?array $effective = null): int
    {
        $floor = DB::table('telemetry_retention_floors')
            ->where('organization_id', $organization->getKey())
            ->where('until', '>', now())
            ->max('days');

        return max(($effective ?? $this->effective($organization))['days'], (int) $floor);
    }

    /**
     * The billing account's retention allowance, or null when neither its plan nor an
     * account override sets one.
     */
    private function billingDays(?Organization $organization): ?int
    {
        $account = $organization?->billingAccount;

        return $account === null ? null : $this->allowances->value($account->withoutRelations(), AllowanceKind::RetentionDays);
    }

    /**
     * The shorter period a running floor holds back, and when it starts: the last floor
     * above the effective period to end.
     *
     * @return array{days: int, from: string}|null
     */
    private function pendingReduction(Organization $organization, int $days): ?array
    {
        $until = DB::table('telemetry_retention_floors')
            ->where('organization_id', $organization->getKey())
            ->where('until', '>', now())
            ->where('days', '>', $days)
            ->max('until');

        return $until === null ? null : ['days' => $days, 'from' => CarbonImmutable::parse((string) $until)->utc()->toIso8601ZuluString()];
    }

    public function update(?Organization $organization, ?int $days, int $revision, bool $confirmed, int $actor): array
    {
        return DB::transaction(function () use ($organization, $days, $revision, $confirmed, $actor) {
            $scope = $organization ? 'organization:'.$organization->uuid : 'platform';
            // Serialize default changes with overrides so reduction decisions use one consistent default.
            TelemetryRetentionSetting::query()->insertOrIgnore(['scope_key' => 'platform', 'revision' => 0, 'created_at' => now(), 'updated_at' => now()]);
            TelemetryRetentionSetting::where('scope_key', 'platform')->lockForUpdate()->first();
            TelemetryRetentionSetting::query()->insertOrIgnore(['scope_key' => $scope, 'organization_id' => $organization?->id, 'revision' => 0, 'created_at' => now(), 'updated_at' => now()]);
            $setting = TelemetryRetentionSetting::where('scope_key', $scope)->lockForUpdate()->firstOrFail();
            abort_unless($setting->revision === $revision, 409, 'Retention settings changed. Refresh before saving.');
            $before = $this->effective($organization);
            // Without its own override an organization falls back to its billing account's, else the platform's.
            $effectiveAfter = $days ?? ($organization ? ($before['billing_days'] ?? $this->effective()['days']) : config('devices.default_retention_days'));
            abort_if($effectiveAfter < $before['days'] && ! $confirmed, 422, 'Confirm the shorter retention period. Older measurements will be permanently deleted during cleanup.');
            $setting->update(['days' => $days, 'revision' => $revision + 1, 'updated_by' => $actor]);
            // A confirmed direct shortening applies at the next cleanup (spec 029 FR-021): it
            // ends the grace a billing change gave the organization.
            if ($organization !== null && $effectiveAfter < $before['days']) {
                DB::table('telemetry_retention_floors')->where('organization_id', $organization->getKey())->delete();
            }
            DeviceAudit::record('telemetry.retention.updated', $organization?->id, $actor, $organization?->uuid,
                ['before_days' => $before['days'], 'after_days' => $effectiveAfter, 'override_days' => $days]);
            DeviceAudit::enqueue('settings.retention.changed.v1', ['scope' => $scope, 'revision' => $revision + 1]);

            return $this->effective($organization);
        });
    }
}
