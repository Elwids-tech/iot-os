<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class DeviceDefinitionAssignmentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'device_uuid' => $this->device->uuid,
            'profile_version_uuid' => $this->profileVersion->uuid,
            'binding_version_uuid' => $this->bindingVersion->uuid,
            'gateway_route_uuid' => $this->gatewayRoute?->uuid,
            'compatibility_state' => $this->compatibility_state->value,
            'profile_artifact_hash' => $this->profile_artifact_hash,
            'binding_artifact_hash' => $this->binding_artifact_hash,
            'route_source_hash' => $this->route_source_hash,
            'runtime_bundle_hash' => $this->runtime_bundle_hash,
            'runtime_bundle' => $this->runtime_bundle,
            'runtime_compiled_at' => $this->runtime_compiled_at?->toAtomString(),
            'revision' => $this->revision,
            'etag' => $this->etag(),
            'locked_at' => $this->locked_at?->toAtomString(),
            'created_at' => $this->created_at?->toAtomString(),
            'updated_at' => $this->updated_at?->toAtomString(),
        ];
    }
}
