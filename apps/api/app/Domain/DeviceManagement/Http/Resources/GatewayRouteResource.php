<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class GatewayRouteResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $gateway = $this->resource->relationLoaded('gateway')
            ? $this->resource->getRelation('gateway')
            : null;
        $device = $this->resource->relationLoaded('device')
            ? $this->resource->getRelation('device')
            : null;
        $profileVersion = $this->resource->relationLoaded('profileVersion')
            ? $this->resource->getRelation('profileVersion')
            : null;
        $bindingVersion = $this->resource->relationLoaded('bindingVersion')
            ? $this->resource->getRelation('bindingVersion')
            : null;

        return [
            'schema' => 'iot.gateway-route.authoring.v2',
            'route' => [
                'uuid' => $this->uuid,
                'revision' => $this->revision,
                'gateway_uuid' => $gateway?->uuid,
                'device_uuid' => $device?->uuid,
                'profile_version_uuid' => $profileVersion?->uuid,
                'binding_version_uuid' => $bindingVersion?->uuid,
                'route_path' => $this->route_path,
                'topic_variables' => (object) ($this->topic_variables ?? []),
                'inbound_scopes' => $this->inbound_scopes,
                'enabled' => $this->enabled,
            ],
            'meta' => [
                'etag' => $this->etag(),
                'assignment_compatibility_state' => $this->whenLoaded(
                    'definitionAssignment',
                    fn (): ?string => $this->definitionAssignment?->compatibility_state?->value,
                ),
                'created_at' => $this->created_at?->toAtomString(),
                'updated_at' => $this->updated_at?->toAtomString(),
            ],
        ];
    }
}
