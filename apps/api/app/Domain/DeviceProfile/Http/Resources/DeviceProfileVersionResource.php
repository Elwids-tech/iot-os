<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class DeviceProfileVersionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'profile_uuid' => $this->profile->uuid,
            'version' => $this->version,
            'state' => $this->state->value,
            'definition' => $this->definition,
            'revision' => $this->revision,
            'etag' => $this->etag(),
            'artifact' => $this->artifact,
            'artifact_hash' => $this->artifact_hash,
            'source_hash' => $this->source_hash,
            'compiler' => $this->compiler,
            'published_at' => $this->published_at?->toAtomString(),
            'retired_at' => $this->retired_at?->toAtomString(),
            'created_at' => $this->created_at?->toAtomString(),
            'updated_at' => $this->updated_at?->toAtomString(),
        ];
    }
}
