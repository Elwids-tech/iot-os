<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class TransportBindingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'adapter_key' => $this->adapter_key,
            'name' => $this->name,
            'status' => $this->status,
            'adapter_config' => $this->adapter_config,
            'compile_status' => $this->compile_status,
            'parameter_mappings' => $this->whenLoaded('parameterMappings', fn () => $this->parameterMappings->map(fn ($mapping): array => [
                'uuid' => $mapping->uuid,
                'parameter_uuid' => $mapping->parameter->uuid,
                'direction' => $mapping->direction,
                'transport_locator' => $mapping->transport_locator,
                'codec_config' => $mapping->codec_config,
                'transform_config' => $mapping->transform_config,
            ])->values()),
        ];
    }
}
