<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Devices\Models\Site;
use App\Domain\Integrations\Services\ApplicationGrants;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

/** Sites for applications under `entities:read` (spec 030, FR-015; ADR-032). */
final class SiteReadController
{
    /**
     * Every site of the organization, ordered by name and not paginated, with the number
     * of devices at it that the application's resolved grant covers.
     */
    public function sites(Request $request, Organization $organization): array
    {
        $granted = ApplicationGrants::for($request->attributes->get('integration_application'))->deviceQuery()
            ->whereNotNull('site_id')->groupBy('site_id')->selectRaw('site_id, count(*) as granted')->pluck('granted', 'site_id');

        return ['data' => Site::where('organization_id', $organization->id)->orderBy('name')->get()->map(fn (Site $site) => [
            ...$site->only(['uuid', 'name', 'timezone', 'address', 'latitude', 'longitude']),
            'granted_devices_count' => (int) ($granted[$site->id] ?? 0),
        ])->values()];
    }
}
