<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class ProfileParameterGroupResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'uuid' => $this->uuid,
            'code' => $this->code,
            'label' => $this->label,
            'description' => $this->description,
            'sort_order' => $this->sort_order,
        ];
    }
}
