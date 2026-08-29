<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class DeviceResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'external_id' => $this->external_id,
            'name' => $this->name,
            'description' => $this->description,
            'lifecycle_state' => $this->lifecycle_state->value,
            'revision' => $this->revision,
            'etag' => $this->etag(),
            'registered_at' => $this->registered_at?->toAtomString(),
            'archived_at' => $this->archived_at?->toAtomString(),
            'created_at' => $this->created_at?->toAtomString(),
            'updated_at' => $this->updated_at?->toAtomString(),
            'definition_assignment' => DeviceDefinitionAssignmentResource::make($this->whenLoaded('definitionAssignment')),
        ];
    }
}
