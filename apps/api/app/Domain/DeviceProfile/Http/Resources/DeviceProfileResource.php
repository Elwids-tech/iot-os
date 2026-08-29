<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Resources;

use App\Domain\DeviceProfile\Models\DeviceProfileVersion;
use App\Domain\DeviceProfile\Support\DeviceDomainJsonShape;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class DeviceProfileResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var DeviceProfileVersion|null $version */
        $version = $this->resource->relationLoaded('versions')
            ? $this->resource->getRelation('versions')->first()
            : null;

        return [
            'schema' => 'iot.device-profile.authoring.v1',
            'profile' => [
                'uuid' => $this->uuid,
                'key' => $this->key,
                'name' => $this->name,
                'description' => $this->description,
            ],
            'version' => $version === null
                ? null
                : DeviceDomainJsonShape::profileVersion($version->definition),
            'meta' => [
                'profile_revision' => $this->revision,
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
