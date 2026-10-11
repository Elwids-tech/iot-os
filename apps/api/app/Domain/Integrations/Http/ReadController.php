<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Automation\Models\Alert;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Integrations\Services\AlertSnapshot;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

final class ReadController
{
    public function devices(Request $request, Organization $organization): array
    {
        $this->pagination($request);
        $page = $this->deviceQuery($request, $organization)->orderBy('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($device) => $this->deviceView($device)), 'meta' => $this->meta($page)];
    }

    public function device(Request $request, Organization $organization, string $uuid): array
    {
        return ['data' => $this->deviceView($this->deviceQuery($request, $organization)->where('uuid', $uuid)->firstOrFail())];
    }

    public function alerts(Request $request, Organization $organization): array
    {
        $this->pagination($request);
        $request->validate(['condition' => 'sometimes|in:active,cleared']);
        $query = $this->alertQuery($request, $organization);
        if ($request->input('condition') === 'active') {
            $query->whereNull('cleared_at');
        }
        if ($request->input('condition') === 'cleared') {
            $query->whereNotNull('cleared_at');
        }
        $page = $query->orderBy('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($alert) => $this->alertView($alert)), 'meta' => $this->meta($page)];
    }

    public function alert(Request $request, Organization $organization, string $uuid): array
    {
        return ['data' => $this->alertView($this->alertQuery($request, $organization)->where('uuid', $uuid)->firstOrFail())];
    }

    private function deviceQuery(Request $request, Organization $organization)
    {
        return Device::where('organization_id', $organization->id)->whereIn('uuid', $request->attributes->get('integration_application')->device_uuids);
    }

    private function alertQuery(Request $request, Organization $organization)
    {
        $devices = $this->deviceQuery($request, $organization)->pluck('uuid')->all();

        return Alert::where('organization_id', $organization->id)->whereHas('deployment', fn ($query) => $query->whereIn('definition->binding->device_uuid', $devices))->with(['workflow', 'deployment']);
    }

    private function pagination(Request $request): void
    {
        $request->validate(['page' => 'sometimes|integer|min:1|max:100000', 'per_page' => 'sometimes|integer|min:1|max:100']);
    }

    private function meta($page): array
    {
        return ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()];
    }

    private function deviceView(Device $device): array
    {
        return [...$device->only(['uuid', 'code', 'name', 'lifecycle', 'last_seen_at']), 'presence' => DeviceView::presence($device)];
    }

    private function alertView(Alert $alert): array
    {
        return AlertSnapshot::of($alert);
    }
}
