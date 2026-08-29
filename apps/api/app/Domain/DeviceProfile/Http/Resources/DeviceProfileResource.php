<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class DeviceProfileResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'key' => $this->key,
            'name' => $this->name,
            'description' => $this->description,
            'revision' => $this->revision,
            'etag' => $this->etag(),
            'archived_at' => $this->archived_at?->toAtomString(),
            'created_at' => $this->created_at?->toAtomString(),
            'updated_at' => $this->updated_at?->toAtomString(),
            'versions_count' => $this->whenCounted('versions'),
            'versions' => DeviceProfileVersionResource::collection($this->whenLoaded('versions')),
        ];
    }
}
