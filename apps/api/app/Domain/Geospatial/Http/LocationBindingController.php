<?php

declare(strict_types=1);

namespace App\Domain\Geospatial\Http;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceConfiguration;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Geospatial\Models\LocationBinding;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class LocationBindingController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function index(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::VIEW, $organization);

        return ['data' => LocationBinding::where('organization_id', $organization->id)->with('device')->orderBy('id')->get()->map(fn ($binding) => $this->view($organization, $binding))];
    }

    public function update(Request $request, Organization $organization, Device $device): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MANAGE, $organization, $device);
        $input = $request->validate(['revision' => 'sometimes|integer|min:0', 'configuration_uuid' => 'required|uuid',
            'latitude_parameter_uuid' => 'required|uuid', 'longitude_parameter_uuid' => 'required|uuid|different:latitude_parameter_uuid',
            'accuracy_parameter_uuid' => 'nullable|uuid|different:latitude_parameter_uuid|different:longitude_parameter_uuid',
            'max_age_seconds' => 'required|integer|between:1,86400', 'max_future_skew_seconds' => 'required|integer|between:0,300',
            'allow_unknown_accuracy' => 'required|boolean']);
        // Accuracy is optional: leaving the key out saves no accuracy parameter, the same as null.
        $input['accuracy_parameter_uuid'] ??= null;
        $configuration = DeviceConfiguration::where('device_id', $device->id)->where('uuid', $input['configuration_uuid'])->firstOrFail();
        abort_unless($device->applied_configuration_uuid === $configuration->uuid || $device->last_applied_configuration_uuid === $configuration->uuid, 422, 'Use the current applied device configuration.');
        $parameters = collect(json_decode($configuration->definition['profile_canonical_json'], true, 512, JSON_THROW_ON_ERROR)['parameters'] ?? [])->pluck('uuid');
        $selected = array_filter([$input['latitude_parameter_uuid'], $input['longitude_parameter_uuid'], $input['accuracy_parameter_uuid']]);
        abort_unless(collect($selected)->every(fn ($uuid) => $parameters->contains($uuid)), 422, 'Every location parameter must belong to the applied profile.');
        $binding = DB::transaction(function () use ($organization, $device, $input, $request) {
            $binding = LocationBinding::where('organization_id', $organization->id)->where('device_id', $device->id)->lockForUpdate()->first();
            abort_unless(($binding?->revision ?? 0) === (int) ($input['revision'] ?? 0), 409, 'The location binding changed. Reload before saving.');
            $values = [...$input, 'organization_id' => $organization->id, 'device_id' => $device->id,
                'generation' => max(1, (int) ($device->applied_generation ?? $device->deployment_generation)), 'revision' => ($binding?->revision ?? 0) + 1, 'updated_by' => $request->user()->id];
            unset($values['revision']);
            if ($binding) {
                $values['revision'] = $binding->revision + 1;
                $binding->update($values);
            } else {
                $values['revision'] = 1;
                $binding = LocationBinding::create($values);
            }
            DeviceAudit::record('location_binding.saved', $organization->id, $request->user()->id, $binding->uuid, ['revision' => $binding->revision]);

            return $binding;
        });

        return ['data' => $this->view($organization, $binding->fresh())];
    }

    public function view(Organization $organization, LocationBinding $binding): array
    {
        return ['schema_version' => 'location-binding.v1', ...$binding->only(['uuid', 'revision', 'configuration_uuid', 'generation',
            'latitude_parameter_uuid', 'longitude_parameter_uuid', 'accuracy_parameter_uuid', 'max_age_seconds',
            'max_future_skew_seconds', 'allow_unknown_accuracy']), 'organization_uuid' => $organization->uuid,
            'device_uuid' => $binding->device->uuid, 'device_name' => $binding->device->name, 'pairing' => 'same_event'];
    }
}
