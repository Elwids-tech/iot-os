<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class DeviceProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'code' => $this->code,
            'name' => $this->name,
            'description' => $this->description,
            'category' => $this->category,
            'status' => $this->status->value,
            'revision' => $this->revision,
            'draft_revision' => $this->draft_revision,
            'definition_hash' => $this->definition_hash,
            'published_at' => $this->published_at?->toIso8601String(),
            'extensions' => $this->extensions,
            'parameters_count' => $this->whenCounted('parameters'),
            'devices_count' => $this->whenHas('devices_count'),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'parameter_groups' => ProfileParameterGroupResource::collection($this->whenLoaded('parameterGroups')),
            'parameters' => ProfileParameterResource::collection($this->whenLoaded('parameters')),
            'alarm_templates' => ProfileAlarmTemplateResource::collection($this->whenLoaded('alarmTemplates')),
            'active_artifact' => DeviceProfileArtifactResource::make($this->whenLoaded('activeArtifact')),
            'transport_bindings' => TransportBindingResource::collection($this->whenLoaded('transportBindings')),
        ];
    }
}
