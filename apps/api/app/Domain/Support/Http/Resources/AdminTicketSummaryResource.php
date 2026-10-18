<?php

declare(strict_types=1);

namespace App\Domain\Support\Http\Resources;

use App\Domain\Support\Models\Ticket;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A ticket in the team's queue.
 *
 * @mixin Ticket
 */
final class AdminTicketSummaryResource extends JsonResource
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
            /** @var 'low'|'normal'|'high'|'urgent' */
            'priority' => $this->priority->value,
            'organization' => $this->organizationSummary(),
            'reporter' => $this->reporterSummary(),
            'assignee' => $this->assigneeSummary(),
            'awaiting_team' => $this->awaitingTeam(),
            'unread' => (bool) $this->unread,
            'last_activity_at' => $this->last_activity_at->toIso8601String(),
            'created_at' => $this->created_at->toIso8601String(),
            'closed_at' => $this->closed_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{uuid: string, name: string}|null
     */
    private function organizationSummary(): ?array
    {
        $organization = $this->organization;

        return $organization ? ['uuid' => (string) $organization->uuid, 'name' => (string) $organization->name] : null;
    }

    /**
     * @return array{id: int, name: string, email: string}
     */
    private function reporterSummary(): array
    {
        return ['id' => (int) $this->reporter->id, 'name' => (string) $this->reporter->name, 'email' => (string) $this->reporter->email];
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private function assigneeSummary(): ?array
    {
        $assignee = $this->assignee;

        return $assignee ? ['id' => (int) $assignee->id, 'name' => (string) $assignee->name] : null;
    }

    /** An open ticket whose last reply came from someone outside the team. */
    private function awaitingTeam(): bool
    {
        return $this->awaiting_team && $this->status->isOpen();
    }
}
