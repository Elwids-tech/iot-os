<?php

declare(strict_types=1);

namespace App\Domain\Support\Services;

use App\Domain\Shared\Models\User;
use App\Domain\Support\Jobs\DeliverTicketEmail;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketEvent;
use App\Domain\Support\Models\TicketMessage;
use Illuminate\Support\Facades\DB;

/**
 * Decides who is emailed about each ticket action (spec 015 US5) and queues one
 * delivery per recipient. Runs inside the action's transaction, which holds the
 * ticket lock, so deliveries and their jobs commit or roll back with the action.
 * Access and preferences are checked again when the email is sent.
 */
final class TicketNotifier
{
    public const PEOPLE = 'people';

    public const TEAM = 'team';

    /** A new ticket: every super administrator. */
    public function filed(Ticket $ticket, TicketMessage $message): void
    {
        $this->queue($ticket, 'filed', $this->except($this->team(null), $ticket->reporter_id), self::TEAM, $message, null);
    }

    /**
     * A reply from the reporter or a participant: the assignee (or the whole team when
     * nobody is assigned) and the other people on the ticket.
     */
    public function personReplied(Ticket $ticket, TicketMessage $message, ?TicketEvent $status): void
    {
        $team = $this->team($ticket->assignee_id);
        $recipients = [];
        foreach ($this->people($ticket) as $id) {
            $recipients[$id] = in_array($id, $team, true) ? self::TEAM : self::PEOPLE;
        }
        foreach ($team as $id) {
            $recipients[$id] = self::TEAM;
        }
        unset($recipients[$message->author_id]);
        $this->queueEach($ticket, 'reply', $recipients, $message, $status);
    }

    /** A team reply, a status change, or both in one action: the reporter and participants. */
    public function teamActed(Ticket $ticket, User $actor, ?TicketMessage $message, ?TicketEvent $status): void
    {
        if ($message === null && $status === null) {
            return;
        }
        $this->queue($ticket, $message !== null ? 'reply' : 'status', $this->except($this->people($ticket), $actor->id), self::PEOPLE, $message, $status);
    }

    /** Someone was tagged: tell them. */
    public function participantAdded(Ticket $ticket, TicketEvent $event, int $userId, int $actorId): void
    {
        if ($userId !== $actorId) {
            $this->queue($ticket, 'participant_added', [$userId], self::PEOPLE, null, $event);
        }
    }

    /** @return list<int> */
    private function people(Ticket $ticket): array
    {
        return array_values(array_unique([
            $ticket->reporter_id,
            ...DB::table('support_ticket_participants')->where('ticket_id', $ticket->id)->pluck('user_id')->map(static fn ($id): int => (int) $id)->all(),
        ]));
    }

    /** @return list<int> */
    private function team(?int $assigneeId): array
    {
        $query = User::query()->where('is_super_admin', true);
        if ($assigneeId !== null && (clone $query)->whereKey($assigneeId)->exists()) {
            $query->whereKey($assigneeId);
        }

        return $query->pluck('id')->map(static fn ($id): int => (int) $id)->all();
    }

    /**
     * @param  list<int>  $ids
     * @return list<int>
     */
    private function except(array $ids, int $userId): array
    {
        return array_values(array_filter($ids, static fn (int $id): bool => $id !== $userId));
    }

    /** @param list<int> $userIds */
    private function queue(Ticket $ticket, string $kind, array $userIds, string $audience, ?TicketMessage $message, ?TicketEvent $event): void
    {
        $this->queueEach($ticket, $kind, array_fill_keys($userIds, $audience), $message, $event);
    }

    /** @param array<int, string> $recipients user id => audience */
    private function queueEach(Ticket $ticket, string $kind, array $recipients, ?TicketMessage $message, ?TicketEvent $event): void
    {
        $actionKey = hash('sha256', implode(':', [$ticket->id, $kind, $message?->id ?? '-', $event?->id ?? '-']));
        foreach ($recipients as $userId => $audience) {
            // The ticket is locked, so this check cannot race; a unique violation would
            // abort the PostgreSQL transaction instead of being ignored.
            if (DB::table('support_ticket_email_deliveries')->where('action_key', $actionKey)->where('user_id', $userId)->exists()) {
                continue;
            }
            $id = DB::table('support_ticket_email_deliveries')->insertGetId([
                'ticket_id' => $ticket->id, 'user_id' => $userId, 'action_key' => $actionKey,
                'audience' => $audience, 'kind' => $kind, 'message_id' => $message?->id, 'event_id' => $event?->id,
                'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
            ]);
            DeliverTicketEmail::dispatch($id)->onConnection('alerts')->onQueue('alerts');
        }
    }
}
