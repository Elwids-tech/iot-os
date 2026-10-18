<?php

declare(strict_types=1);

namespace App\Domain\Support\Http\Controllers;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Http\Resources\TicketResource;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Services\TicketAccess;
use App\Domain\Support\Services\Tickets;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Tagging colleagues (spec 015 US4). The reporter adds and removes participants;
 * a participant can only leave.
 */
final class TicketParticipantController
{
    public function __construct(private readonly TicketAccess $access, private readonly Tickets $tickets) {}

    public function update(Request $request, Organization $organization, Ticket $ticket, User $user): TicketResource
    {
        $actor = $request->user();
        $this->authorizeTicket($actor, $organization, $ticket);
        abort_unless($ticket->reporter_id === $actor->id, 403, 'Only the reporter can tag people.');

        return new TicketResource($this->tickets->addParticipant($actor, $ticket, $user));
    }

    /** Remove a participant, or leave the ticket yourself. */
    public function destroy(Request $request, Organization $organization, Ticket $ticket, User $user): Response
    {
        $actor = $request->user();
        $this->authorizeTicket($actor, $organization, $ticket);
        abort_unless($ticket->reporter_id === $actor->id || $actor->id === $user->id, 403, 'Only the reporter can remove people.');
        $this->tickets->removeParticipant($actor, $ticket, $user);

        return response()->noContent();
    }

    private function authorizeTicket(User $user, Organization $organization, Ticket $ticket): void
    {
        abort_unless($ticket->organization_id === $organization->id && $this->access->canSeeAsPerson($user, $ticket), 404, 'Ticket not found.');
    }
}
