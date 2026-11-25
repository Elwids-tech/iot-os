<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\Site;
use App\Domain\Entities\Models\EntityType;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * What one application may see, resolved for one request (spec 030, research R7).
 *
 * A grant is a list of devices or a scope of sites, never both. This is the only place
 * a device is judged granted: every integration read, the event feed and webhook
 * deliveries filter through it (constitution III). The resolved set is computed afresh
 * for each request and never stored; a site scope has no ceiling.
 */
final class ApplicationGrant
{
    public const DEVICES = 'devices';

    public const SITES = 'sites';

    /** @var ?list<int> */
    private ?array $siteIds = null;

    /**
     * @param  list<string>  $deviceUuids
     * @param  list<string>  $siteUuids
     */
    public function __construct(
        public readonly int $organizationId,
        public readonly array $deviceUuids,
        public readonly array $siteUuids,
    ) {}

    /** `devices` when the device list is non-empty, else `sites`. */
    public function kind(): string
    {
        return $this->deviceUuids !== [] ? self::DEVICES : self::SITES;
    }

    /**
     * Whether the device is granted right now: in the list, or at a site of the scope.
     * A device with no site is never covered by a site scope.
     */
    public function covers(Device $device): bool
    {
        if ($device->organization_id !== $this->organizationId) {
            return false;
        }
        if ($this->kind() === self::DEVICES) {
            return in_array($device->uuid, $this->deviceUuids, true);
        }

        return $device->site_id !== null && in_array((int) $device->site_id, $this->siteIds(), true);
    }

    /** Whether a site is the scope's or inside a scoped site's branch. */
    public function coversSite(int $siteId): bool
    {
        return $this->kind() === self::SITES && in_array($siteId, $this->siteIds(), true);
    }

    /**
     * The granted devices as a query, always inside the organization: a `whereIn('uuid')`
     * for a list, a `whereIn('site_id')` for a scope. An empty scope matches nothing.
     */
    public function deviceQuery(?Builder $query = null): Builder
    {
        $query = ($query ?? Device::query())->where('organization_id', $this->organizationId);

        return $this->kind() === self::DEVICES
            ? $query->whereIn('uuid', $this->deviceUuids)
            : $query->whereIn('site_id', $this->siteIds());
    }

    /**
     * The UUIDs of the devices covered right now, for the feed page filter and the
     * webhook delivery check. No ceiling for a site scope.
     *
     * @return list<string>
     */
    public function resolveUuids(): array
    {
        return $this->deviceQuery()->pluck('uuid')->all();
    }

    /**
     * The scope's sites and every site inside their branches, resolved once per request
     * through the organization. A device's site is the nearest Site entity above its
     * place (spec 009, research R8), so a device placed anywhere in a scoped site's
     * branch, under a nested site too, is covered.
     *
     * @return list<int>
     */
    private function siteIds(): array
    {
        if ($this->siteIds !== null) {
            return $this->siteIds;
        }
        $scoped = $this->siteUuids === [] ? collect()
            : Site::where('organization_id', $this->organizationId)->whereIn('uuid', $this->siteUuids)->pluck('id');

        return $this->siteIds = $scoped->isEmpty() ? [] : DB::table('entity_closure')
            ->join('entities', 'entities.id', '=', 'entity_closure.descendant_id')
            ->join('entity_types', 'entity_types.id', '=', 'entities.entity_type_id')
            ->whereIn('entity_closure.ancestor_id', $scoped)->where('entity_types.key', EntityType::SITE)
            ->pluck('entities.id')->map(fn ($id) => (int) $id)->unique()->values()->all();
    }
}
