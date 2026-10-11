<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Automation\Models\Deployment;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Services\RetentionService;
use App\Domain\Devices\Services\RuntimeClient;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;

final class LocationController
{
    private function query(Request $request, Organization $organization, string $uuid)
    {
        Device::where('organization_id', $organization->id)
            ->whereIn('uuid', $request->attributes->get('integration_application')->device_uuids)
            ->where('uuid', $uuid)->firstOrFail();

        return Deployment::whereIn('automation_workflow_id', function ($query) use ($organization) {
            $query->select('id')->from('automation_workflows')->where('organization_id', $organization->id);
        })->where('target', 'active')->where('status', 'applied')
            ->where('definition->binding->device_uuid', $uuid)
            ->where('definition->binding->organization_uuid', $organization->uuid)
            ->where('definition->binding->schema_version', 'location-binding.v1');
    }

    public function bindings(Request $request, Organization $organization, string $uuid): array
    {
        $request->validate(['page' => 'sometimes|integer|min:1|max:100000', 'per_page' => 'sometimes|integer|min:1|max:100']);
        $page = $this->query($request, $organization, $uuid)->orderBy('id')->paginate($request->integer('per_page', 25));

        return ['data' => $page->getCollection()->map(fn ($version) => [
            'version_uuid' => $version->uuid,
            'binding' => Arr::only($version->definition['binding'], [
                'schema_version', 'uuid', 'revision', 'organization_uuid', 'device_uuid',
                'configuration_uuid', 'generation', 'latitude_parameter_uuid', 'longitude_parameter_uuid',
                'accuracy_parameter_uuid', 'pairing', 'max_age_seconds', 'max_future_skew_seconds', 'allow_unknown_accuracy',
            ]),
        ]), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]];
    }

    public function show(Request $request, Organization $organization, string $uuid, string $event): array
    {
        $request->validate(['version_uuid' => ['required', 'uuid']]);
        abort_unless(Str::isUuid($event), 404);
        $version = $this->query($request, $organization, $uuid)->where('uuid', $request->input('version_uuid'))->firstOrFail();
        $result = app(RuntimeClient::class)->request('POST', '/internal/locations/read', [
            'binding' => $version->definition['binding'], 'event_id' => $event,
            'retention_days' => app(RetentionService::class)->effective($organization)['days'],
        ]);
        abort_unless($result['found'] ?? false, 404);

        return ['version_uuid' => $version->uuid, 'data' => $result['data']];
    }
}
