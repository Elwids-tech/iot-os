<?php

declare(strict_types=1);

namespace App\Domain\Support\Http\Resources;

use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Services\TicketView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A ticket as the team sees it: everything, internal notes and working fields included.
 *
 * @mixin Ticket
 */
final class AdminTicketResource extends JsonResource
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
            'assignee' => $this->assigneeSummary(),
            'awaiting_team' => $this->awaitingTeam(),
            'revision' => (int) $this->revision,
            // Pass back to the read endpoint so later activity stays unread.
            'sequence' => (int) $this->sequence,
            'context' => $this->contextSummary(),
            'last_activity_at' => $this->last_activity_at->toIso8601String(),
            'created_at' => $this->created_at->toIso8601String(),
            'closed_at' => $this->closed_at?->toIso8601String(),
            'people' => $this->people(),
            'timeline' => $this->timeline(),
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
     * @return array{id: int, name: string}|null
     */
    private function assigneeSummary(): ?array
    {
        $assignee = $this->assignee;

        return $assignee ? ['id' => (int) $assignee->id, 'name' => (string) $assignee->name] : null;
    }

    /**
     * @return array{path: string|null, user_agent: string|null, screen: string|null, time_zone: string|null}
     */
    private function contextSummary(): array
    {
        $context = $this->context ?? [];

        return [
            'path' => isset($context['path']) ? (string) $context['path'] : null,
            'user_agent' => isset($context['user_agent']) ? (string) $context['user_agent'] : null,
            'screen' => isset($context['screen']) ? (string) $context['screen'] : null,
            'time_zone' => isset($context['time_zone']) ? (string) $context['time_zone'] : null,
        ];
    }

    /**
     * The reporter first, then participants in the order they were tagged.
     *
     * @return list<array{id: int, name: string, email: string, role: 'reporter'|'participant'}>
     */
    private function people(): array
    {
        return app(TicketView::class)->people($this->resource);
    }

    /**
     * Messages and changes in the order they happened. Changes carry the old and new
     * value: a status, priority, type or title, or a person for assignee and people changes.
     *
     * @return list<array{type: 'message'|'event', key: string, created_at: string, actor: array{id: int, name: string}|null, from_team: bool, internal: bool, body: string|null, attachments: list<array{uuid: string, name: string, mime: string, size: int}>, event: 'created'|'status'|'priority'|'type'|'title'|'assignee'|'participant_added'|'participant_removed'|'participant_left'|null, from: string|array{id: int, name: string}|null, to: string|array{id: int, name: string}|null, cause: string|null}>
     */
    private function timeline(): array
    {
        return app(TicketView::class)->timeline($this->resource, true);
    }

    /** An open ticket whose last reply came from someone outside the team. */
    private function awaitingTeam(): bool
    {
        return $this->awaiting_team && $this->status->isOpen();
    }
}
