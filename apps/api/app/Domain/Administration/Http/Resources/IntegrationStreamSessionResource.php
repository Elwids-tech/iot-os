<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources;

use App\Domain\Integrations\Models\IntegrationStreamSession;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin IntegrationStreamSession */
final class IntegrationStreamSessionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (int) $this->id,
            'application' => ['uuid' => (string) $this->application->uuid, 'name' => (string) $this->application->name],
            'opened_at' => $this->opened_at->toJSON(),
            'last_seen_at' => $this->last_seen_at->toJSON(),
            'device_count' => (int) $this->device_count,
            'last_position' => $this->last_position === null ? null : (string) $this->last_position,
        ];
    }
}
