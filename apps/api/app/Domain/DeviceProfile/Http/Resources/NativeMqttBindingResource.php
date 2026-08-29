<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Resources;

use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Support\DeviceDomainJsonShape;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class NativeMqttBindingResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var TransportBindingVersion|null $version */
        $version = $this->resource->relationLoaded('versions')
            ? $this->resource->getRelation('versions')->first()
            : null;
        $profile = $this->resource->relationLoaded('profile')
            ? $this->resource->getRelation('profile')
            : null;

        return [
            'schema' => 'iot.native-mqtt-binding.authoring.v1',
            'binding' => [
                'uuid' => $this->uuid,
                'profile_uuid' => $profile?->uuid,
                'key' => $this->key,
                'name' => $this->name,
                'description' => $this->description,
                'transport' => $this->transport,
            ],
            'version' => $version === null
                ? null
                : DeviceDomainJsonShape::bindingVersion($version->definition),
            'meta' => [
                'binding_revision' => $this->revision,
                'version_revision' => $version?->revision,
                'state' => $version?->state?->value,
                'artifact_hash' => $version?->artifact_hash,
                'etag' => $this->etag(),
                'created_at' => $this->created_at?->toAtomString(),
                'updated_at' => $this->updated_at?->toAtomString(),
            ],
        ];
    }
}
