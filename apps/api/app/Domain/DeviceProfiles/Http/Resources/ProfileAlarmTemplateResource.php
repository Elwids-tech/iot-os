<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class ProfileAlarmTemplateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'code' => $this->code,
            'name' => $this->name,
            'type' => $this->type,
            'severity' => $this->severity,
            'condition_config' => $this->condition_config,
            'enabled_by_default' => $this->enabled_by_default,
            'parameter_references' => $this->whenLoaded('parameterReferences', fn () => $this->parameterReferences->map(fn ($reference): array => [
                'parameter_uuid' => $reference->parameter->uuid,
                'role' => $reference->role,
            ])->values()),
        ];
    }
}
