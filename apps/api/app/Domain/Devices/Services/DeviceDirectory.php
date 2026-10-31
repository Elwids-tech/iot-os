<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Builder;

/**
 * Finding an organization's devices, shared by the portal's device list and agent
 * tools (spec 004), so both apply the same filters.
 */
final class DeviceDirectory
{
    /** Presence the agent tools filter on; the portal list filters on status instead. */
    public const PRESENCE = ['online', 'offline', 'unknown', 'unseen', 'quiet'];

    /** Lifecycles the portal list filters on; "current" is every lifecycle but archived. */
    public const LIFECYCLES = ['registered', 'active', 'deactivated', 'archived', 'current'];

    /**
     * The one status the portal's device list shows and groups by (`deviceHealth` in
     * apps/portal/src/devices/model.ts, without "quiet", which lists leave to Last seen).
     */
    public const STATUSES = ['online', 'offline', 'unseen', 'unknown', 'unconfigured', 'updating', 'failed', 'deactivated', 'archived'];

    /**
     * @param  array{search?: ?string, lifecycle?: ?string, profile_uuid?: ?string, site_uuid?: ?string, tag?: ?string, presence?: ?string, status?: ?list<string>}  $filters
     * @return Builder<Device>
     */
    public function query(Organization $organization, array $filters): Builder
    {
        return Device::query()->where('organization_id', $organization->id)->with(['candidate.gateway' => fn ($q) => $q->withCount('candidates'), 'candidate.gateway.connection', 'candidate.assignedDevice', 'latestOperation', 'appliedConfiguration.artifact.profile', 'lastAppliedConfiguration.artifact.profile', 'site'])
            ->when($filters['site_uuid'] ?? null, fn ($q, $uuid) => $q->whereHas('site', fn ($site) => $site->where('uuid', $uuid)))
            ->when($filters['tag'] ?? null, fn ($q, $tag) => $q->whereJsonContains('tags', trim($tag)))
            ->when($filters['search'] ?? null, fn ($q, $s) => $q->where(fn ($q) => $q->whereRaw('LOWER(name) LIKE ?', ['%'.mb_strtolower($s).'%'])->orWhereRaw('LOWER(code) LIKE ?', ['%'.mb_strtolower($s).'%'])))
            ->when($filters['lifecycle'] ?? null, fn ($q, $s) => $s === 'current' ? $q->where('lifecycle', '!=', 'archived') : $q->where('lifecycle', $s))
            // A device's profile is its applied configuration's, or the last applied one while inactive.
            ->when($filters['profile_uuid'] ?? null, fn ($q, $uuid) => $q->where(fn ($q) => $q
                ->whereHas('appliedConfiguration.artifact.profile', fn ($p) => $p->where('uuid', $uuid))
                ->orWhere(fn ($q) => $q->whereNull('applied_configuration_uuid')->whereHas('lastAppliedConfiguration.artifact.profile', fn ($p) => $p->where('uuid', $uuid)))))
            ->when($filters['presence'] ?? null, fn ($q, $presence) => $this->presence($q, $presence))
            ->when($filters['status'] ?? null, fn ($q, array $statuses) => $q->where(function (Builder $q) use ($statuses): void {
                foreach ($statuses as $status) {
                    $q->orWhere(fn (Builder $q) => $this->status($q, $status));
                }
            }));
    }

    /**
     * The list's status, with the portal's precedence: archived, a failed or pending
     * configuration, deactivated, never configured, then the connection.
     *
     * @param  Builder<Device>  $query
     */
    private function status(Builder $query, string $status): void
    {
        $unarchived = fn (Builder $q) => $q->where('lifecycle', '!=', 'archived');
        $settled = fn (Builder $q) => $unarchived($q)->whereNotIn('deployment_status', ['failed', 'pending']);
        match ($status) {
            'archived' => $query->where('lifecycle', 'archived'),
            'failed' => $unarchived($query)->where('deployment_status', 'failed'),
            'updating' => $unarchived($query)->where('deployment_status', 'pending'),
            'deactivated' => $settled($query)->where('lifecycle', 'deactivated'),
            'unconfigured' => $settled($query)->where('lifecycle', 'registered'),
            default => $this->presence($settled($query)->where('lifecycle', 'active'), $status),
        };
    }

    /**
     * The same presence DeviceView reports: "online" older than 20 seconds of runtime
     * contact is unknown. "Quiet" is online with no reading for an hour.
     *
     * @param  Builder<Device>  $query
     */
    private function presence(Builder $query, string $presence): void
    {
        $fresh = now()->subSeconds(20);
        match ($presence) {
            'online' => $query->where('presence', 'online')->where('runtime_seen_at', '>=', $fresh),
            'quiet' => $query->where('presence', 'online')->where('runtime_seen_at', '>=', $fresh)
                ->where(fn ($q) => $q->whereNull('last_seen_at')->orWhere('last_seen_at', '<', now()->subHour())),
            'unknown' => $query->where(fn ($q) => $q->where('presence', 'unknown')
                ->orWhere(fn ($q) => $q->where('presence', 'online')->where(fn ($q) => $q->whereNull('runtime_seen_at')->orWhere('runtime_seen_at', '<', $fresh)))),
            default => $query->where('presence', $presence),
        };
    }
}
