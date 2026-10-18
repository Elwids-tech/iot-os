<?php

declare(strict_types=1);

namespace App\Domain\Support\Http\Resources;

use App\Domain\Support\Models\Ticket;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A ticket in a person's Support list. Times are of public activity only, so team-only
 * work never shows through.
 *
 * @mixin Ticket
 */
final class TicketSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->uuid,
            'number' => (int) $this->id,
            'title' => (string) $this->title,
            /** @var 'bug'|'feature_request'|'improvement' */
            'type' => $this->type->value,
            /** @var 'new'|'in_review'|'needs_info'|'planned'|'in_progress'|'resolved'|'declined' */
            'status' => $this->status->value,
            /** @var 'reporter'|'participant' */
            'role' => $this->reporter_id === $request->user()->id ? 'reporter' : 'participant',
            'reporter' => $this->reporterSummary(),
            'unread' => (bool) $this->unread,
            'last_activity_at' => $this->last_public_activity_at->toIso8601String(),
            'created_at' => $this->created_at->toIso8601String(),
            'closed_at' => $this->closed_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{id: int, name: string}
     */
    private function reporterSummary(): array
    {
        return ['id' => (int) $this->reporter->id, 'name' => (string) $this->reporter->name];
    }
}
