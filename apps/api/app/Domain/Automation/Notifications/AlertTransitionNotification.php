<?php

declare(strict_types=1);

namespace App\Domain\Automation\Notifications;

use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

/**
 * One alert transition a recipient received, for their bell (spec 022). Written by
 * AlertProjector in the runtime inbox transaction, so it is not queued. The id is a
 * UUIDv7, which sorts by time: send each instance to one notifiable only.
 */
final class AlertTransitionNotification extends Notification
{
    /**
     * @param  array{organization_uuid: string, alert_uuid: string, episode: int, transition: 'activated'|'cleared', occurred_at: string, workflow_uuid: string, workflow_name: string, device_uuid: ?string, device_name: ?string}  $data
     */
    public function __construct(private readonly array $data)
    {
        $this->id = (string) Str::uuid7();
    }

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function databaseType(object $notifiable): string
    {
        return 'alert';
    }

    /**
     * @return array<string, mixed>
     */
    public function toDatabase(object $notifiable): array
    {
        return ['v' => 1, 'source' => 'workflow', ...$this->data];
    }
}
