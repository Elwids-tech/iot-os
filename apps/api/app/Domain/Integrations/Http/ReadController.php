<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Automation\Models\Alert;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\DeviceView;
use App\Domain\Integrations\Services\AlertSnapshot;
use App\Domain\Integrations\Services\ApplicationGrants;
use App\Domain\Shared\Models\Organization;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\Request;

final class ReadController
{
    // Scramble does not read the rules in pagination(); these describe them in the
    // public contract (contracts/openapi). Keep them in step with pagination().
    #[QueryParameter('page', description: 'Page number.', type: 'int<1, 100000>', default: 1)]
    #[QueryParameter('per_page', description: 'Items per page.', type: 'int<1, 100>', default: 25)]
    public function devices(Request $request, Organization $organization): array
    {
        $this->pagination($request);
        $page = $this->deviceQuery($request, $organization)->orderBy('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($device) => $this->deviceView($device)), 'meta' => $this->meta($page)];
    }

    /** The device with its profile, site and parameters (spec 030, FR-014); the list stays as it is. */
    public function device(Request $request, Organization $organization, string $uuid): array
    {
        $device = $this->deviceQuery($request, $organization)->where('uuid', $uuid)->firstOrFail();

        return ['data' => [...$this->deviceView($device), 'profile' => DeviceView::profile($device), 'site' => DeviceView::site($device), 'parameters' => $this->parameters($device)]];
    }

    // Scramble does not read the rules in pagination(); these describe them in the
    // public contract (contracts/openapi). Keep them in step with pagination().
    #[QueryParameter('page', description: 'Page number.', type: 'int<1, 100000>', default: 1)]
    #[QueryParameter('per_page', description: 'Items per page.', type: 'int<1, 100>', default: 25)]
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

    /** The granted devices, judged by the one resolver (spec 030); the middleware proved the organization. */
    private function deviceQuery(Request $request, Organization $organization)
    {
        return ApplicationGrants::for($request->attributes->get('integration_application'))->deviceQuery(Device::where('organization_id', $organization->id));
    }

    private function alertQuery(Request $request, Organization $organization)
    {
        $devices = $this->deviceQuery($request, $organization)->pluck('uuid')->all();

        // Workflow alerts only: IntegrationAlert requires a workflow (spec 018, FR-029).
        return Alert::where('organization_id', $organization->id)->where('kind', Alert::WORKFLOW)->whereHas('deployment', fn ($query) => $query->whereIn('definition->binding->device_uuid', $devices))->with(['workflow', 'deployment']);
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

    /**
     * The parameters of the configuration's profile, as the latest read names them
     * (research R9): the name is the profile's label and the decimals its display
     * precision. Empty when the device has no profile revision, never an error.
     *
     * @return list<array<string, mixed>>
     */
    private function parameters(Device $device): array
    {
        $canonical = ($device->appliedConfiguration ?? $device->lastAppliedConfiguration)?->definition['profile_canonical_json'] ?? null;
        $profile = is_string($canonical) ? json_decode($canonical, true) : $canonical;

        return collect(is_array($profile) ? ($profile['parameters'] ?? []) : [])->map(fn (array $parameter) => [
            'uuid' => $parameter['uuid'], 'key' => $parameter['key'], 'name' => $parameter['label'] ?? $parameter['key'],
            'unit' => $parameter['unit'] ?? null, 'data_type' => $parameter['data_type'] ?? null,
            'decimals' => isset($parameter['display']['precision']) ? (int) $parameter['display']['precision'] : null,
            'accepts_command' => (bool) ($parameter['accepts_command'] ?? false), 'reports_state' => (bool) ($parameter['reports_state'] ?? false),
        ])->values()->all();
    }

    private function alertView(Alert $alert): array
    {
        return AlertSnapshot::of($alert);
    }
}
