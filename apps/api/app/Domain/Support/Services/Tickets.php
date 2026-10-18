<?php

declare(strict_types=1);

namespace App\Domain\Support\Services;

use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Enums\TicketEventKind;
use App\Domain\Support\Enums\TicketPriority;
use App\Domain\Support\Enums\TicketStatus;
use App\Domain\Support\Enums\TicketType;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketEvent;
use App\Domain\Support\Models\TicketMessage;
use App\Domain\Support\Models\TicketParticipant;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Every change to a ticket (spec 015). Each action locks the ticket, appends to its
 * timeline, keeps the activity columns that drive unread marks and the team's queue,
 * and queues the emails it causes, all in one transaction.
 */
final class Tickets
{
    public const MAX_PARTICIPANTS = 10;

    public function __construct(
        private readonly TicketAccess $access,
        private readonly TicketAttachments $attachments,
        private readonly TicketNotifier $notifier,
    ) {}

    /**
     * File a ticket. Sending the same client id again returns the ticket it created.
     *
     * @param  array{client_id: string, type: string, title: string, body?: ?string, context?: ?array<string, mixed>}  $values
     * @param  list<UploadedFile>  $files
     */
    public function file(User $reporter, Organization $organization, array $values, array $files): Ticket
    {
        $body = $this->body($values['body'] ?? null, $files);
        $checked = $this->attachments->check($files);
        if ($existing = $this->filedBefore($reporter, $values, $body)) {
            return $existing;
        }
        $written = [];
        try {
            return DB::transaction(function () use ($reporter, $organization, $values, $body, $checked, &$written): Ticket {
                $now = now();
                $ticket = Ticket::create([
                    'organization_id' => $organization->id, 'reporter_id' => $reporter->id, 'client_id' => $values['client_id'],
                    'type' => $values['type'], 'title' => $values['title'], 'status' => TicketStatus::NEW, 'priority' => TicketPriority::NORMAL,
                    'context' => $values['context'] ?? null, 'revision' => 1, 'awaiting_team' => true,
                    'last_activity_at' => $now, 'last_public_activity_at' => $now, 'last_public_actor_id' => $reporter->id,
                    'sequence' => 1, 'public_sequence' => 1,
                ]);
                $message = TicketMessage::create([
                    'ticket_id' => $ticket->id, 'author_id' => $reporter->id, 'body' => $body, 'internal' => false,
                    'client_id' => $values['client_id'], 'created_at' => $now,
                ]);
                $this->attachments->store($ticket, $message, $checked, $written);
                $this->event($ticket, $reporter, TicketEventKind::CREATED, null, null, at: $now);
                $this->seen($reporter, $ticket);
                $this->notifier->filed($ticket, $message);

                return $ticket;
            });
        } catch (UniqueConstraintViolationException $exception) {
            // Two identical submissions raced; the first one won.
            $this->attachments->discard($written);

            return $this->filedBefore($reporter, $values, $body) ?? throw $exception;
        } catch (\Throwable $exception) {
            $this->attachments->discard($written);
            throw $exception;
        }
    }

    /**
     * A reply, or for the team also an internal note, optionally with a status change in
     * the same action. A person's reply reopens a resolved ticket and answers a request
     * for information.
     *
     * @param  array{client_id: string, body?: ?string}  $values
     * @param  list<UploadedFile>  $files
     */
    public function reply(User $author, Ticket $ticket, array $values, array $files, bool $asTeam, bool $internal = false, ?TicketStatus $status = null, ?int $revision = null): TicketMessage
    {
        $internal = $asTeam && $internal;
        $body = $this->body($values['body'] ?? null, $files);
        $checked = $this->attachments->check($files);
        if ($existing = $this->sentBefore($author, $ticket, $values['client_id'], $body, $internal)) {
            return $existing;
        }
        $written = [];
        try {
            return DB::transaction(function () use ($author, $ticket, $values, $body, $checked, $asTeam, $internal, $status, $revision, &$written): TicketMessage {
                $ticket = $this->lock($ticket);
                if (! $this->access->canReply($author, $ticket, $asTeam)) {
                    throw ValidationException::withMessages(['body' => 'This ticket was declined, so it takes no more replies. File a new ticket about it instead.']);
                }
                $changesStatus = $asTeam && $status !== null && $status !== $ticket->status;
                if ($changesStatus) {
                    $this->guardRevision($ticket, $revision);
                }
                $this->attachments->ensureRoom($ticket, count($checked));
                $now = now();
                $message = TicketMessage::create([
                    'ticket_id' => $ticket->id, 'author_id' => $author->id, 'body' => $body, 'internal' => $internal,
                    'from_team' => $asTeam, 'client_id' => $values['client_id'], 'created_at' => $now,
                ]);
                $this->attachments->store($ticket, $message, $checked, $written);

                $statusEvent = null;
                if (! $asTeam && in_array($ticket->status, [TicketStatus::NEEDS_INFO, TicketStatus::RESOLVED], true)) {
                    $statusEvent = $this->changeStatus($ticket, $author, TicketStatus::IN_REVIEW, $now, cause: 'reply', message: $message);
                } elseif ($changesStatus) {
                    $statusEvent = $this->changeStatus($ticket, $author, $status, $now, message: $internal ? null : $message);
                }
                if ($statusEvent !== null) {
                    $ticket->revision++;
                }
                if (! $internal) {
                    $ticket->awaiting_team = ! $asTeam;
                }
                $this->touch($ticket, $author, $now, public: ! $internal || $statusEvent !== null);

                if ($asTeam) {
                    $this->notifier->teamActed($ticket, $author, $internal ? null : $message, $statusEvent);
                } else {
                    $this->notifier->personReplied($ticket, $message, $statusEvent);
                }

                return $message;
            });
        } catch (UniqueConstraintViolationException $exception) {
            $this->attachments->discard($written);

            return $this->sentBefore($author, $ticket, $values['client_id'], $body, $internal) ?? throw $exception;
        } catch (\Throwable $exception) {
            $this->attachments->discard($written);
            throw $exception;
        }
    }

    /**
     * Change fields. The team changes status, priority, type, title and assignee under
     * the ticket's revision; the reporter changes the title or closes the ticket.
     *
     * @param  array{status?: string, priority?: string, type?: string, title?: string, assignee_id?: ?int}  $changes
     */
    public function update(User $actor, Ticket $ticket, array $changes, bool $asTeam, ?int $revision = null): Ticket
    {
        return DB::transaction(function () use ($actor, $ticket, $changes, $asTeam, $revision): Ticket {
            $ticket = $this->lock($ticket);
            if ($asTeam) {
                $this->guardRevision($ticket, $revision);
            }
            $now = now();
            $events = [];
            $statusEvent = null;
            if (isset($changes['status']) && $changes['status'] !== $ticket->status->value) {
                $events[] = $statusEvent = $this->changeStatus($ticket, $actor, TicketStatus::from($changes['status']), $now);
            }
            if (isset($changes['type']) && $changes['type'] !== $ticket->type->value) {
                $events[] = $this->event($ticket, $actor, TicketEventKind::TYPE, $ticket->type->value, $changes['type'], at: $now);
                $ticket->type = TicketType::from($changes['type']);
            }
            if (isset($changes['title']) && $changes['title'] !== $ticket->title) {
                $events[] = $this->event($ticket, $actor, TicketEventKind::TITLE, $ticket->title, $changes['title'], at: $now);
                $ticket->title = $changes['title'];
            }
            if (isset($changes['priority']) && $changes['priority'] !== $ticket->priority->value) {
                $events[] = $this->event($ticket, $actor, TicketEventKind::PRIORITY, $ticket->priority->value, $changes['priority'], at: $now);
                $ticket->priority = TicketPriority::from($changes['priority']);
            }
            if (array_key_exists('assignee_id', $changes) && $changes['assignee_id'] !== $ticket->assignee_id) {
                $events[] = $this->event($ticket, $actor, TicketEventKind::ASSIGNEE, $this->person($ticket->assignee_id), $this->person($changes['assignee_id']), at: $now);
                $ticket->assignee_id = $changes['assignee_id'];
            }
            if ($events === []) {
                return $ticket;
            }
            $ticket->revision++;
            $this->touch($ticket, $actor, $now, public: collect($events)->contains(static fn (TicketEvent $event): bool => ! $event->internal));
            if ($asTeam && $statusEvent !== null) {
                $this->notifier->teamActed($ticket, $actor, null, $statusEvent);
            }

            return $ticket;
        });
    }

    public function addParticipant(User $actor, Ticket $ticket, User $user): Ticket
    {
        return DB::transaction(function () use ($actor, $ticket, $user): Ticket {
            $ticket = $this->lock($ticket);
            if ($ticket->organization_id === null || ! $this->access->isMember($user, $ticket->organization_id)) {
                throw ValidationException::withMessages(['user_id' => 'Only members of this ticket\'s organization can be added.']);
            }
            if ($user->id === $ticket->reporter_id || $ticket->participants()->where('user_id', $user->id)->exists()) {
                return $ticket;
            }
            if ($ticket->participants()->count() >= self::MAX_PARTICIPANTS) {
                throw ValidationException::withMessages(['user_id' => sprintf('A ticket can have %d people tagged.', self::MAX_PARTICIPANTS)]);
            }
            $now = now();
            TicketParticipant::create(['ticket_id' => $ticket->id, 'user_id' => $user->id, 'added_by' => $actor->id, 'created_at' => $now]);
            $event = $this->event($ticket, $actor, TicketEventKind::PARTICIPANT_ADDED, null, $this->person($user->id), at: $now);
            $this->touch($ticket, $actor, $now, public: true);
            $this->notifier->participantAdded($ticket, $event, $user->id, $actor->id);

            return $ticket;
        });
    }

    /** Remove a participant, or leave when the actor removes themself. */
    public function removeParticipant(User $actor, Ticket $ticket, User $user): Ticket
    {
        return DB::transaction(function () use ($actor, $ticket, $user): Ticket {
            $ticket = $this->lock($ticket);
            $participant = $ticket->participants()->where('user_id', $user->id)->first();
            abort_if($participant === null, 404, 'This person is not tagged on the ticket.');
            $participant->delete();
            $now = now();
            $kind = $actor->id === $user->id ? TicketEventKind::PARTICIPANT_LEFT : TicketEventKind::PARTICIPANT_REMOVED;
            $this->event($ticket, $actor, $kind, $this->person($user->id), null, at: $now);
            $this->touch($ticket, $actor, $now, public: true);

            return $ticket;
        });
    }

    /**
     * Record how far someone has read. The team reads everything; people read the
     * public activity, up to the sequence their page showed when one is given, so
     * activity that arrived after the page loaded stays unread.
     */
    public function markRead(User $user, Ticket $ticket, bool $team, ?int $seen = null): void
    {
        $ticket->refresh();
        $column = $team ? 'sequence' : 'public_sequence';
        $seen = min($seen ?? $ticket->{$column}, $ticket->{$column});
        $row = DB::table('support_ticket_reads')->where('ticket_id', $ticket->id)->where('user_id', $user->id)->first();
        if ($row !== null && (int) $row->{$column} >= $seen) {
            return;
        }
        DB::table('support_ticket_reads')->upsert(
            [['ticket_id' => $ticket->id, 'user_id' => $user->id, 'sequence' => $team ? $seen : (int) ($row->sequence ?? 0),
                'public_sequence' => $team ? max((int) ($row->public_sequence ?? 0), $ticket->public_sequence) : $seen, 'read_at' => now()]],
            ['ticket_id', 'user_id'],
            ['sequence', 'public_sequence', 'read_at'],
        );
    }

    /** Permanently remove a ticket with its messages, timeline and files. */
    public function delete(User $actor, Ticket $ticket): void
    {
        DB::transaction(function () use ($actor, $ticket): void {
            $ticket = $this->lock($ticket);
            DeviceAudit::record('support.ticket_deleted', $ticket->organization_id, $actor->id, $ticket->uuid, [
                'number' => $ticket->id, 'reporter_id' => $ticket->reporter_id,
            ]);
            $ticket->delete();
        });
        $this->attachments->deleteAll($ticket);
    }

    private function lock(Ticket $ticket): Ticket
    {
        return Ticket::query()->whereKey($ticket->id)->lockForUpdate()->firstOrFail();
    }

    private function guardRevision(Ticket $ticket, ?int $revision): void
    {
        abort_unless($revision === $ticket->revision, 409, 'This ticket changed since you opened it. Reload it and try again.');
    }

    private function changeStatus(Ticket $ticket, User $actor, TicketStatus $to, Carbon $at, ?string $cause = null, ?TicketMessage $message = null): TicketEvent
    {
        $from = $ticket->status;
        $ticket->status = $to;
        if (! $to->isOpen()) {
            $ticket->closed_at = $from->isOpen() ? $at : $ticket->closed_at;
        } else {
            $ticket->closed_at = null;
        }

        return $this->event($ticket, $actor, TicketEventKind::STATUS, $from->value, $to->value, cause: $cause, message: $message, at: $at);
    }

    private function event(Ticket $ticket, ?User $actor, TicketEventKind $kind, mixed $from, mixed $to, ?string $cause = null, ?TicketMessage $message = null, ?Carbon $at = null): TicketEvent
    {
        return TicketEvent::create([
            'ticket_id' => $ticket->id, 'actor_id' => $actor?->id, 'kind' => $kind, 'from' => $from, 'to' => $to,
            'internal' => $kind->isInternal(), 'cause' => $cause, 'message_id' => $message?->id, 'created_at' => $at ?? now(),
        ]);
    }

    /**
     * Count one action on the ticket. The sequences drive unread marks exactly, where
     * timestamps would tie within a second; public activity is what people see.
     */
    private function touch(Ticket $ticket, User $actor, Carbon $at, bool $public): void
    {
        $ticket->sequence++;
        $ticket->last_activity_at = $at;
        if ($public) {
            $ticket->public_sequence++;
            $ticket->last_public_activity_at = $at;
            $ticket->last_public_actor_id = $actor->id;
        }
        $ticket->save();
        $this->seen($actor, $ticket);
    }

    /** Whoever acted has seen the ticket up to their own action. */
    private function seen(User $user, Ticket $ticket): void
    {
        DB::table('support_ticket_reads')->upsert(
            [['ticket_id' => $ticket->id, 'user_id' => $user->id, 'sequence' => $ticket->sequence, 'public_sequence' => $ticket->public_sequence, 'read_at' => now()]],
            ['ticket_id', 'user_id'],
            ['sequence', 'public_sequence', 'read_at'],
        );
    }

    /** @return array{id: int, name: string}|null */
    private function person(?int $userId): ?array
    {
        if ($userId === null) {
            return null;
        }
        $user = User::query()->find($userId, ['id', 'name']);

        return $user ? ['id' => $user->id, 'name' => $user->name] : null;
    }

    /** @param list<UploadedFile> $files */
    private function body(?string $body, array $files): string
    {
        $body = rtrim((string) $body);
        if (trim($body) === '' && $files === []) {
            throw ValidationException::withMessages(['body' => 'Write a message or attach a file.']);
        }

        return $body;
    }

    /** @param array{client_id: string, type: string, title: string} $values */
    private function filedBefore(User $reporter, array $values, string $body): ?Ticket
    {
        $ticket = Ticket::query()->where('reporter_id', $reporter->id)->where('client_id', $values['client_id'])->first();
        if ($ticket === null) {
            return null;
        }
        $first = $ticket->messages()->orderBy('id')->value('body');
        abort_unless($ticket->type->value === $values['type'] && $ticket->title === $values['title'] && $first === $body, 409, 'This ticket id was already used for a different ticket.');

        return $ticket;
    }

    private function sentBefore(User $author, Ticket $ticket, string $clientId, string $body, bool $internal): ?TicketMessage
    {
        $message = TicketMessage::query()->where('author_id', $author->id)->where('client_id', $clientId)->first();
        if ($message === null) {
            return null;
        }
        abort_unless($message->ticket_id === $ticket->id && $message->body === $body && $message->internal === $internal, 409, 'This message id was already used for a different message.');

        return $message;
    }
}
