<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class DeviceProfileArtifactResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'profile_uuid' => $this->profile?->uuid,
            'revision' => $this->revision,
            'definition_hash' => $this->definition_hash,
            'definition' => $this->definition,
            'status' => $this->status->value,
            'compiled_at' => $this->compiled_at?->toIso8601String(),
        ];
    }
}
