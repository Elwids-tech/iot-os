<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class GatewayResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'schema' => 'iot.gateway.authoring.v2',
            'gateway' => [
                'uuid' => $this->uuid,
                'key' => $this->key,
                'name' => $this->name,
                'description' => $this->description,
                'mqtt_client_id' => $this->mqtt_client_id,
            ],
            'meta' => [
                'revision' => $this->revision,
                'etag' => $this->etag(),
                'routes_count' => $this->whenCounted('routes'),
                'created_at' => $this->created_at?->toAtomString(),
                'updated_at' => $this->updated_at?->toAtomString(),
            ],
        ];
    }
}
