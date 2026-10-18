<?php

declare(strict_types=1);

namespace App\Domain\Support\Services;

use App\Domain\Shared\Models\User;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketAttachment;
use App\Domain\Support\Models\TicketEvent;
use App\Domain\Support\Models\TicketMessage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * What a ticket looks like to the person asking: the timeline (without internal notes
 * and team-only changes unless they are on the team), the people on it, what they may
 * do, and which tickets are unread for them.
 */
final class TicketView
{
    public function __construct(private readonly TicketAccess $access) {}

    /**
     * Messages and changes in the order they happened; a reply comes before the status
     * change it caused.
     *
     * @return list<array{type: string, key: string, created_at: string, actor: array{id: int, name: string}|null, from_team: bool, internal: bool, body: string|null, attachments: list<array{uuid: string, name: string, mime: string, size: int}>, event: string|null, from: string|array{id: int, name: string}|null, to: string|array{id: int, name: string}|null, cause: string|null}>
     */
    public function timeline(Ticket $ticket, bool $team): array
    {
        $messages = TicketMessage::query()->where('ticket_id', $ticket->id)
            ->when(! $team, fn (Builder $query) => $query->where('internal', false))
            ->with(['author:id,name', 'attachments'])->orderBy('id')->get()
            ->map(fn (TicketMessage $message): array => [
                'type' => 'message',
                'key' => 'm-'.$message->uuid,
                'created_at' => $message->created_at->toIso8601String(),
                'actor' => $message->author ? ['id' => (int) $message->author->id, 'name' => (string) $message->author->name] : null,
                'from_team' => (bool) $message->from_team,
                'internal' => (bool) $message->internal,
                'body' => (string) $message->body,
                'attachments' => $message->attachments->sortBy('id')->map(static fn (TicketAttachment $attachment): array => [
                    'uuid' => (string) $attachment->uuid, 'name' => (string) $attachment->name,
                    'mime' => (string) $attachment->mime, 'size' => (int) $attachment->size,
                ])->values()->all(),
                'event' => null, 'from' => null, 'to' => null, 'cause' => null,
                'sort' => [$message->created_at->getTimestamp() * 1_000_000 + (int) $message->created_at->format('u'), 0, $message->id],
            ]);
        $events = TicketEvent::query()->where('ticket_id', $ticket->id)
            ->when(! $team, fn (Builder $query) => $query->where('internal', false))
            ->with('actor:id,name')->orderBy('id')->get()
            ->map(fn (TicketEvent $event): array => [
                'type' => 'event',
                'key' => 'e-'.$event->id,
                'created_at' => $event->created_at->toIso8601String(),
                'actor' => $event->actor ? ['id' => (int) $event->actor->id, 'name' => (string) $event->actor->name] : null,
                'from_team' => false,
                'internal' => (bool) $event->internal,
                'body' => null,
                'attachments' => [],
                'event' => $event->kind->value,
                'from' => $event->from,
                'to' => $event->to,
                'cause' => $event->cause,
                'sort' => [$event->created_at->getTimestamp() * 1_000_000 + (int) $event->created_at->format('u'), 1, $event->id],
            ]);

        return $messages->concat($events)
            ->sort(static fn (array $a, array $b): int => $a['sort'] <=> $b['sort'])
            ->map(static function (array $item): array {
                unset($item['sort']);

                return $item;
            })
            ->values()->all();
    }

    /**
     * @return list<array{id: int, name: string, email: string, role: string}>
     */
    public function people(Ticket $ticket): array
    {
        $reporter = $ticket->reporter()->first(['id', 'name', 'email']);
        $participants = DB::table('support_ticket_participants')->join('users', 'users.id', '=', 'support_ticket_participants.user_id')
            ->where('ticket_id', $ticket->id)->orderBy('support_ticket_participants.id')
            ->get(['users.id', 'users.name', 'users.email']);

        return [
            ['id' => (int) $reporter->id, 'name' => (string) $reporter->name, 'email' => (string) $reporter->email, 'role' => 'reporter'],
            ...$participants->map(static fn ($user): array => ['id' => (int) $user->id, 'name' => (string) $user->name, 'email' => (string) $user->email, 'role' => 'participant'])->all(),
        ];
    }

    /**
     * What a reporter or participant may do on the ticket page.
     *
     * @return array{reply: bool, close: bool, edit_title: bool, manage_people: bool, leave: bool}
     */
    public function abilities(User $viewer, Ticket $ticket): array
    {
        $reporter = $ticket->reporter_id === $viewer->id;

        return [
            'reply' => $this->access->canReply($viewer, $ticket, false),
            'close' => $reporter && $ticket->status->isOpen(),
            'edit_title' => $reporter,
            'manage_people' => $reporter && $ticket->organization_id !== null,
            'leave' => ! $reporter,
        ];
    }

    /**
     * Adds an `unread` column: for people, public activity since they last read the
     * ticket; for the team, any activity.
     *
     * @param  Builder<Ticket>  $query
     * @return Builder<Ticket>
     */
    public function withUnread(Builder $query, User $user, bool $team): Builder
    {
        $column = $team ? 'sequence' : 'public_sequence';

        return $this->joinReads($query, $user)->select('support_tickets.*')
            ->selectRaw("CASE WHEN support_tickets.{$column} > COALESCE(ticket_read.{$column}, 0) THEN 1 ELSE 0 END AS unread");
    }

    /**
     * @param  Builder<Ticket>  $query
     * @return Builder<Ticket>
     */
    public function whereUnreadForPerson(Builder $query, User $user): Builder
    {
        return $this->joinReads($query, $user)->whereRaw('support_tickets.public_sequence > COALESCE(ticket_read.public_sequence, 0)');
    }

    /**
     * @param  Builder<Ticket>  $query
     * @return Builder<Ticket>
     */
    private function joinReads(Builder $query, User $user): Builder
    {
        return $query->leftJoin('support_ticket_reads as ticket_read', fn (JoinClause $join) => $join
            ->on('ticket_read.ticket_id', '=', 'support_tickets.id')->where('ticket_read.user_id', '=', $user->id));
    }
}
