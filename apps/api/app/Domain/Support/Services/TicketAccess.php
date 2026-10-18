<?php

declare(strict_types=1);

namespace App\Domain\Support\Services;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Enums\TicketStatus;
use App\Domain\Support\Models\Ticket;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Who may see a ticket (spec 015 FR-003, FR-004).
 *
 * - The team (super administrators) sees every ticket.
 * - Anyone else sees a ticket while they are its reporter or a participant and a
 *   current member of its organization. A ticket whose organization was deleted is
 *   the team's only.
 */
final class TicketAccess
{
    public function isTeam(User $user): bool
    {
        return (bool) $user->is_super_admin;
    }

    public function isMember(User $user, ?int $organizationId): bool
    {
        return $organizationId !== null
            && DB::table('organization_user')->where('organization_id', $organizationId)->where('user_id', $user->id)->exists();
    }

    /** Reporter or participant, regardless of membership. */
    public function isPerson(User $user, Ticket $ticket): bool
    {
        return $ticket->reporter_id === $user->id
            || DB::table('support_ticket_participants')->where('ticket_id', $ticket->id)->where('user_id', $user->id)->exists();
    }

    public function canSee(User $user, Ticket $ticket): bool
    {
        return $this->isTeam($user) || $this->canSeeAsPerson($user, $ticket);
    }

    /** Access through the ticket itself, never through the team role. */
    public function canSeeAsPerson(User $user, Ticket $ticket): bool
    {
        return $this->isMember($user, $ticket->organization_id) && $this->isPerson($user, $ticket);
    }

    /** People may reply to any ticket except a declined one; the team always may. */
    public function canReply(User $user, Ticket $ticket, bool $asTeam): bool
    {
        return $asTeam ? $this->isTeam($user) : $ticket->status !== TicketStatus::DECLINED;
    }

    /**
     * The tickets of one organization this person filed or was tagged on. The route's
     * middleware has already checked membership.
     *
     * @return Builder<Ticket>
     */
    public function visibleIn(User $user, Organization $organization): Builder
    {
        return Ticket::query()
            ->where('support_tickets.organization_id', $organization->id)
            ->where(fn (Builder $query) => $query
                ->where('support_tickets.reporter_id', $user->id)
                ->orWhereExists(fn ($exists) => $exists->selectRaw('1')->from('support_ticket_participants')
                    ->whereColumn('support_ticket_participants.ticket_id', 'support_tickets.id')
                    ->where('support_ticket_participants.user_id', $user->id)));
    }
}
