<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\TelemetryRetentionSetting;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;

final class RetentionService
{
    public function inspection(?Organization $organization = null): array
    {
        $last = DB::table('device_audit_events')->where('action', 'retention.cleanup')
            ->when($organization, fn ($query) => $query->where('organization_id', $organization->id))->latest('id')->first();
        $failures = DB::table('device_audit_events')->whereIn('id', function ($query): void {
            $query->selectRaw('MAX(id)')->from('device_audit_events')->where('action', 'retention.cleanup')->groupBy('organization_id');
        })->where('details->status', 'failed')->when($organization, fn ($query) => $query->where('organization_id', $organization->id))->count();

        return [...$this->effective($organization), 'cleanup' => $last ? ['at' => $last->created_at, ...json_decode($last->details, true)] : null, 'cleanup_failures' => $failures];
    }

    public function effective(?Organization $organization = null): array
    {
        $platform = TelemetryRetentionSetting::where('scope_key', 'platform')->first();
        $override = $organization ? TelemetryRetentionSetting::where('scope_key', 'organization:'.$organization->uuid)->first() : null;
        $selected = $override?->days !== null ? $override : $platform;

        return ['days' => $selected?->days ?? config('devices.default_retention_days'),
            'source' => $override?->days !== null ? 'organization' : ($platform?->days !== null ? 'platform' : 'default'),
            'override_days' => $organization ? $override?->days : $platform?->days,
            'revision' => ($organization ? $override?->revision : $platform?->revision) ?? 0,
            'platform_days' => $platform?->days ?? config('devices.default_retention_days'),
            'cutoff' => now()->subDays($selected?->days ?? config('devices.default_retention_days'))->toIso8601String()];
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
            $effectiveAfter = $days ?? ($organization ? $this->effective()['days'] : config('devices.default_retention_days'));
            abort_if($effectiveAfter < $before['days'] && ! $confirmed, 422, 'Confirm the shorter retention period. Older measurements will be permanently deleted during cleanup.');
            $setting->update(['days' => $days, 'revision' => $revision + 1, 'updated_by' => $actor]);
            DeviceAudit::record('telemetry.retention.updated', $organization?->id, $actor, $organization?->uuid,
                ['before_days' => $before['days'], 'after_days' => $effectiveAfter, 'override_days' => $days]);
            DeviceAudit::enqueue('settings.retention.changed.v1', ['scope' => $scope, 'revision' => $revision + 1]);

            return $this->effective($organization);
        });
    }
}
