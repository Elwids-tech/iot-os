<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Resources;

use App\Domain\DeviceProfiles\Services\PublishedParameters;
use App\Domain\DeviceProfiles\Services\UnitCatalogue;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class ProfileParameterResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'parameter_group_uuid' => $this->group?->uuid,
            'key' => $this->key,
            'label' => $this->label,
            'description' => $this->description,
            'kind' => $this->kind->value,
            'data_type' => $this->data_type->value,
            'format' => $this->format,
            'unit' => $this->unit,
            'unit_quantity' => app(UnitCatalogue::class)->quantity($this->unit),
            'published' => app(PublishedParameters::class)->isPublished($this->resource),
            'reports_state' => $this->reports_state,
            'accepts_command' => $this->accepts_command,
            'validation_logic' => $this->validation_logic,
            'display_config' => $this->display_config,
            'reporting_config' => $this->reporting_config,
            'counter_config' => $this->counter_config,
            'ingress_conversion' => $this->ingress_conversion,
            'sort_order' => $this->sort_order,
            'calculation' => $this->whenLoaded('calculation', fn (): ?array => $this->calculation === null ? null : [
                'uuid' => $this->calculation->uuid,
                'engine' => $this->calculation->engine,
                'expression' => $this->calculation->expression,
                'trigger' => $this->calculation->trigger,
                'failure_policy' => $this->calculation->failure_policy,
                'inputs' => $this->calculation->inputs->map(fn ($input): array => [
                    'parameter_uuid' => $input->parameter->uuid,
                    'alias' => $input->alias,
                ])->values(),
            ]),
        ];
    }
}
