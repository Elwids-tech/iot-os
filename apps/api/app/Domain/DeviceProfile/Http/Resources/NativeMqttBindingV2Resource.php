<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Resources;

use App\Domain\DeviceProfile\Models\TransportBindingVersion;
use App\Domain\DeviceProfile\Support\DeviceDomainV2JsonShape;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class NativeMqttBindingV2Resource extends JsonResource
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
            'schema' => 'iot.native-mqtt-binding.authoring.v2',
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
                : DeviceDomainV2JsonShape::bindingVersion($version->definition),
            'meta' => [
                'binding_revision' => $this->revision,
                'version_revision' => $version?->revision,
                'state' => $version?->state?->value,
                'contract_version' => $version?->contract_version?->value,
                'artifact_hash' => $version?->artifact_hash,
                'etag' => $this->etag(),
                'created_at' => $this->created_at?->toAtomString(),
                'updated_at' => $this->updated_at?->toAtomString(),
            ],
        ];
    }
}
