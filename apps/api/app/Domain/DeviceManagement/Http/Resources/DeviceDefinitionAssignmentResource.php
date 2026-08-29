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
            'revision' => $this->revision,
            'etag' => $this->etag(),
            'locked_at' => $this->locked_at?->toAtomString(),
            'created_at' => $this->created_at?->toAtomString(),
            'updated_at' => $this->updated_at?->toAtomString(),
        ];
    }
}
