<?php

declare(strict_types=1);

namespace App\Domain\Entities\Http\Resources;

use App\Domain\Devices\Models\Device;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A device placed at an entity or in its branch.
 *
 * @mixin Device
 */
final class PlacedDeviceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->uuid,
            'name' => (string) $this->name,
            'code' => (string) $this->code,
            'lifecycle' => (string) $this->lifecycle,
            'entity' => $this->place(),
        ];
    }

    /**
     * @return array{uuid: string, name: string, path: string}
     */
    private function place(): array
    {
        return ['uuid' => (string) $this->entity->uuid, 'name' => (string) $this->entity->name, 'path' => (string) $this->entity->path];
    }
}
