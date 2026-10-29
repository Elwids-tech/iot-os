<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What the bell polls (spec 022): the unread count, and the newest unread activation so
 * the portal can tell a new alert from the backlog.
 */
final class AlertNotificationSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'unread' => (int) $this->resource['unread'],
            /** @format uuid */
            'newest_unread_activation_id' => $this->resource['newest_unread_activation_id'] === null ? null : (string) $this->resource['newest_unread_activation_id'],
        ];
    }
}
