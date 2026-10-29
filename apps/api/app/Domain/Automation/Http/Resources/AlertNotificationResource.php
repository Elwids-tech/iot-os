<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Notifications\DatabaseNotification;

/**
 * One alert transition in a person's bell (spec 022). Names are as they were when it
 * arrived; the alert's condition is read now.
 *
 * @mixin DatabaseNotification
 */
final class AlertNotificationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @format uuid */
            'id' => (string) $this->id,
            /** @var 'activated'|'cleared' */
            'transition' => $this->data['transition'] === 'activated' ? 'activated' : 'cleared',
            /** @format date-time */
            'occurred_at' => (string) $this->data['occurred_at'],
            /** @format date-time */
            'created_at' => $this->created_at->toIso8601ZuluString(),
            /** @format date-time */
            'read_at' => $this->read_at?->toIso8601ZuluString(),
            'alert' => $this->alert(),
            'workflow' => $this->workflow(),
            'device' => $this->device(),
        ];
    }

    /**
     * @return array{uuid: string, episode: int, condition: 'active'|'cleared'}
     */
    private function alert(): array
    {
        return ['uuid' => (string) $this->data['alert_uuid'], 'episode' => (int) $this->data['episode'], 'condition' => $this->condition === 'active' ? 'active' : 'cleared'];
    }

    /**
     * @return array{uuid: string, name: string}
     */
    private function workflow(): array
    {
        return ['uuid' => (string) $this->data['workflow_uuid'], 'name' => (string) $this->data['workflow_name']];
    }

    /**
     * Null when the alert has no bound device or it was not found.
     *
     * @return array{uuid: string, name: string}|null
     */
    private function device(): ?array
    {
        if (($this->data['device_uuid'] ?? null) === null || ($this->data['device_name'] ?? null) === null) {
            return null;
        }

        return ['uuid' => (string) $this->data['device_uuid'], 'name' => (string) $this->data['device_name']];
    }
}
