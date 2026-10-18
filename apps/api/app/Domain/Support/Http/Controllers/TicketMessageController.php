<?php

declare(strict_types=1);

namespace App\Domain\Support\Http\Controllers;

use App\Domain\Shared\Models\Organization;
use App\Domain\Support\Http\Resources\TicketResource;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Services\TicketAccess;
use App\Domain\Support\Services\TicketAttachments;
use App\Domain\Support\Services\Tickets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Replies from the reporter and the people they tagged (spec 015 US3). */
final class TicketMessageController
{
    public function __construct(private readonly TicketAccess $access, private readonly Tickets $tickets) {}

    /** Reply with text, attachments or both; returns the updated ticket. */
    public function store(Request $request, Organization $organization, Ticket $ticket): JsonResponse
    {
        $user = $request->user();
        abort_unless($ticket->organization_id === $organization->id && $this->access->canSeeAsPerson($user, $ticket), 404, 'Ticket not found.');
        $values = $request->validate([
            'client_id' => ['required', 'uuid'],
            'body' => ['nullable', 'string', 'max:10000'],
            ...TicketAttachments::rules(),
        ]);
        $this->tickets->reply($user, $ticket, $values, $request->file('files', []), asTeam: false);

        return (new TicketResource($ticket->refresh()))->response()->setStatusCode(201);
    }
}
