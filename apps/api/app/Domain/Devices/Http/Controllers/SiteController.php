<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Models\Site;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

final class SiteController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return [
            'data' => Site::query()->where('organization_id', $organization->id)->withCount('devices')->orderBy('name')->get()->map->toView(),
            'organization_timezone' => $organization->timezone,
        ];
    }

    public function store(Request $request, Organization $organization)
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $site = Site::create([...$this->values($request, $organization), 'organization_id' => $organization->id, 'created_by' => $request->user()->id, 'updated_by' => $request->user()->id]);
        DeviceAudit::record('site.created', $organization->id, $request->user()->id, $site->uuid);

        return response()->json(['data' => $site->loadCount('devices')->toView()], 201);
    }

    public function update(Request $request, Organization $organization, Site $site): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $site);
        $site->update([...$this->values($request, $organization, $site), 'updated_by' => $request->user()->id]);
        DeviceAudit::record('site.updated', $organization->id, $request->user()->id, $site->uuid);

        return ['data' => $site->loadCount('devices')->toView()];
    }

    /** Devices at the site keep working; they fall back to the organization's time zone. */
    public function destroy(Request $request, Organization $organization, Site $site): Response
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $site);
        $site->delete();
        DeviceAudit::record('site.deleted', $organization->id, $request->user()->id, $site->uuid);

        return response()->noContent();
    }

    /** The organization's zone applies to devices without a site. */
    public function updateOrganizationTimezone(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization);
        $values = $request->validate(['timezone' => ['present', 'nullable', 'timezone:all']]);
        $organization->forceFill(['timezone' => $values['timezone']])->save();
        DeviceAudit::record('organization.timezone.updated', $organization->id, $request->user()->id, $organization->uuid, ['timezone' => $values['timezone']]);

        return ['data' => ['timezone' => $organization->timezone]];
    }

    private function values(Request $request, Organization $organization, ?Site $site = null): array
    {
        $values = $request->validate([
            'name' => [$site ? 'sometimes' : 'required', 'string', 'max:120', Rule::unique('sites')->where('organization_id', $organization->id)->ignore($site?->id)],
            'timezone' => [$site ? 'sometimes' : 'required', 'timezone:all'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
            // Not "sometimes": a coordinate sent alone must fail required_with.
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
        ]);
        if (isset($values['name'])) {
            $values['name'] = trim($values['name']);
        }

        return $values;
    }
}
