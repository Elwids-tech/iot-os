<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Devices\Models\Device;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * What one application may see, resolved for one request (spec 030, research R7).
 *
 * A grant is a list of devices or a scope of entities, never both. This is the only place
 * a device is judged granted: every integration read, the event feed and webhook
 * deliveries filter through it (constitution III). The resolved set is computed afresh
 * for each request and never stored; a scope has no ceiling.
 *
 * A scope covers every device anchored in a scoped entity's branch: placed there now, or
 * last placed there when archived (spec 009, FR-026, research R5). A site scope is a scope
 * of Site entities. A device whose site was set without a placement (old fixtures) is
 * judged by that site, as its time zone is.
 */
final class ApplicationGrant
{
    public const DEVICES = 'devices';

    public const ENTITIES = 'entities';

    /** @var ?list<int> */
    private ?array $branchIds = null;

    /**
     * @param  list<string>  $deviceUuids
     * @param  list<string>  $entityUuids
     */
    public function __construct(
        public readonly int $organizationId,
        public readonly array $deviceUuids,
        public readonly array $entityUuids,
    ) {}

    /** `devices` when the device list is non-empty, else `entities`. */
    public function kind(): string
    {
        return $this->deviceUuids !== [] ? self::DEVICES : self::ENTITIES;
    }

    /** Whether the device is granted right now: in the list, or anchored in a scoped branch. */
    public function covers(Device $device): bool
    {
        if ($device->organization_id !== $this->organizationId) {
            return false;
        }
        if ($this->kind() === self::DEVICES) {
            return in_array($device->uuid, $this->deviceUuids, true);
        }

        // A site set without a placement (old fixtures) stands in for the anchor, as for time zones.
        $anchor = $device->entity_id ?? $device->site_id;

        return $anchor !== null && in_array((int) $anchor, $this->branchIds(), true);
    }

    /**
     * The granted devices as a query, always inside the organization: a `whereIn('uuid')`
     * for a list, the anchors in the scoped branches for a scope. An empty scope matches
     * nothing.
     */
    public function deviceQuery(?Builder $query = null): Builder
    {
        $query = ($query ?? Device::query())->where('organization_id', $this->organizationId);

        return $this->kind() === self::DEVICES
            ? $query->whereIn('uuid', $this->deviceUuids)
            : $query->where(fn (Builder $query) => $query->whereIn($query->qualifyColumn('entity_id'), $this->branchQuery())
                ->orWhere(fn (Builder $query) => $query->whereNull($query->qualifyColumn('entity_id'))->whereIn($query->qualifyColumn('site_id'), $this->branchQuery())));
    }

    /**
     * The UUIDs of the devices covered right now, for the feed page filter and the
     * webhook delivery check. No ceiling for a scope.
     *
     * @return list<string>
     */
    public function resolveUuids(): array
    {
        return $this->deviceQuery()->pluck('uuid')->all();
    }

    /** The active scoped entities of the organization, as an id subquery. */
    public function scopedQuery(): QueryBuilder
    {
        return DB::table('entities')->select('id')->where('organization_id', $this->organizationId)
            ->whereNull('archived_at')->whereIn('uuid', $this->kind() === self::ENTITIES ? $this->entityUuids : []);
    }

    /** Every entity in a scoped branch, the scoped entities included, as an id subquery. */
    public function branchQuery(): QueryBuilder
    {
        return DB::table('entity_closure')->select('descendant_id')->whereIn('ancestor_id', $this->scopedQuery());
    }

    /** @return list<int> */
    private function branchIds(): array
    {
        return $this->branchIds ??= $this->branchQuery()->distinct()->pluck('descendant_id')->map(fn ($id) => (int) $id)->all();
    }
}
