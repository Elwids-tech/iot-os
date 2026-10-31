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
            /** What kind of alert: an automation's, or a device connectivity alert (spec 018). */
            'kind' => $this->kind(),
            'subject' => $this->subject(),
            'workflow' => $this->workflow(),
            'device' => $this->device(),
        ];
    }

    /**
     * Notifications written before spec 018 carry no kind; they are all workflow alerts.
     *
     * @return 'workflow'|'device_offline'|'gateway_offline'|'connection_lost'
     */
    private function kind(): string
    {
        $kind = $this->data['kind'] ?? 'workflow';

        return in_array($kind, ['device_offline', 'gateway_offline', 'connection_lost'], true) ? $kind : 'workflow';
    }

    /**
     * The device, gateway or adapter a connectivity alert is about; null for workflow alerts.
     *
     * @return array{type: 'device'|'gateway'|'adapter', uuid: string, name: string}|null
     */
    private function subject(): ?array
    {
        $subject = $this->data['subject'] ?? null;
        if (! is_array($subject) || ! in_array($subject['type'] ?? null, ['device', 'gateway', 'adapter'], true)) {
            return null;
        }
        $type = match ($subject['type']) {
            'device' => 'device',
            'gateway' => 'gateway',
            default => 'adapter',
        };

        return ['type' => $type, 'uuid' => (string) $subject['uuid'], 'name' => (string) $subject['name']];
    }

    /**
     * @return array{uuid: string, episode: int, condition: 'active'|'cleared'}
     */
    private function alert(): array
    {
        return ['uuid' => (string) $this->data['alert_uuid'], 'episode' => (int) $this->data['episode'], 'condition' => $this->condition === 'active' ? 'active' : 'cleared'];
    }

    /**
     * Null for device connectivity alerts.
     *
     * @return array{uuid: string, name: string}|null
     */
    private function workflow(): ?array
    {
        if (($this->data['workflow_uuid'] ?? null) === null) {
            return null;
        }

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
