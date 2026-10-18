<?php

declare(strict_types=1);

namespace App\Domain\Support\Http\Controllers;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Enums\TicketPriority;
use App\Domain\Support\Enums\TicketStatus;
use App\Domain\Support\Enums\TicketType;
use App\Domain\Support\Http\Resources\AdminTicketResource;
use App\Domain\Support\Http\Resources\AdminTicketSummaryResource;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketAttachment;
use App\Domain\Support\Services\TicketAccess;
use App\Domain\Support\Services\TicketAttachments;
use App\Domain\Support\Services\Tickets;
use App\Domain\Support\Services\TicketView;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The team's ticket queue in the admin app (spec 015 US2, US6). Super administrators
 * only; everyone else, platform administrators included, gets 403.
 */
final class AdminTicketController
{
    public const PER_PAGE = 50;

    public function __construct(
        private readonly TicketAccess $access,
        private readonly Tickets $tickets,
        private readonly TicketView $view,
    ) {}

    /** Open tickets by default, those awaiting the team first, then by last activity. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $this->team($request);
        $input = $request->validate([
            'state' => ['sometimes', Rule::in(['open', 'closed', 'all'])],
            'status' => ['sometimes', 'array'],
            'status.*' => [Rule::enum(TicketStatus::class)],
            'type' => ['sometimes', Rule::enum(TicketType::class)],
            'priority' => ['sometimes', Rule::enum(TicketPriority::class)],
            'organization' => ['sometimes', 'uuid'],
            'assignee' => ['sometimes', 'string', 'regex:/^(me|none|[0-9]{1,18})$/'],
            'awaiting' => ['sometimes', 'boolean'],
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $open = TicketStatus::openValues();
        $query = $this->view->withUnread(Ticket::query(), $user, true)->with(['organization:id,uuid,name', 'reporter:id,name,email', 'assignee:id,name']);
        if (isset($input['status'])) {
            $query->whereIn('support_tickets.status', $input['status']);
        } else {
            match ($input['state'] ?? 'open') {
                'open' => $query->whereIn('support_tickets.status', $open),
                'closed' => $query->whereNotIn('support_tickets.status', $open),
                default => null,
            };
        }
        foreach (['type', 'priority'] as $field) {
            if (isset($input[$field])) {
                $query->where('support_tickets.'.$field, $input[$field]);
            }
        }
        if (isset($input['organization'])) {
            $query->whereIn('support_tickets.organization_id', Organization::withTrashed()->where('uuid', $input['organization'])->select('id'));
        }
        match ($input['assignee'] ?? null) {
            null => null,
            'me' => $query->where('support_tickets.assignee_id', $user->id),
            'none' => $query->whereNull('support_tickets.assignee_id'),
            default => $query->where('support_tickets.assignee_id', (int) $input['assignee']),
        };
        if ($request->boolean('awaiting')) {
            $query->where('support_tickets.awaiting_team', true)->whereIn('support_tickets.status', $open);
        }
        TicketController::search($query, $input['search'] ?? null);
        $page = $query
            ->orderByRaw('CASE WHEN support_tickets.awaiting_team AND support_tickets.status IN ('.implode(',', array_fill(0, count($open), '?')).') THEN 0 ELSE 1 END', $open)
            ->orderByDesc('support_tickets.last_activity_at')->orderByDesc('support_tickets.id')
            ->paginate(self::PER_PAGE);

        return AdminTicketSummaryResource::collection($page)->additional(['meta' => ['awaiting' => $this->awaiting()]]);
    }

    /** How many open tickets wait for the team, for the sidebar badge. */
    public function summary(Request $request): JsonResponse
    {
        $this->team($request);

        return response()->json(['data' => ['awaiting' => $this->awaiting()]]);
    }

    public function show(Request $request, Ticket $ticket): AdminTicketResource
    {
        $this->team($request);

        return new AdminTicketResource($ticket);
    }

    /** Change status, priority, type, title or assignee under the ticket's revision. */
    public function update(Request $request, Ticket $ticket): AdminTicketResource
    {
        $user = $this->team($request);
        $values = $request->validate([
            'revision' => ['required', 'integer', 'min:1'],
            'status' => ['sometimes', Rule::enum(TicketStatus::class)],
            'priority' => ['sometimes', Rule::enum(TicketPriority::class)],
            'type' => ['sometimes', Rule::enum(TicketType::class)],
            'title' => ['sometimes', 'string', 'min:3', 'max:150'],
            'assignee_id' => ['sometimes', 'nullable', 'integer', Rule::exists('users', 'id')->where('is_super_admin', true)],
        ]);
        if (isset($values['title'])) {
            $values['title'] = TicketController::title($values['title']);
        }
        $revision = (int) $values['revision'];
        unset($values['revision']);

        return new AdminTicketResource($this->tickets->update($user, $ticket, $values, true, $revision));
    }

    /** A reply or an internal note, optionally setting the status in the same action. */
    public function message(Request $request, Ticket $ticket): JsonResponse
    {
        $user = $this->team($request);
        $values = $request->validate([
            'client_id' => ['required', 'uuid'],
            'body' => ['nullable', 'string', 'max:10000'],
            'internal' => ['sometimes', 'boolean'],
            'status' => ['sometimes', 'nullable', Rule::enum(TicketStatus::class)],
            'revision' => ['required_with:status', 'nullable', 'integer', 'min:1'],
            ...TicketAttachments::rules(),
        ]);
        $status = isset($values['status']) ? TicketStatus::from($values['status']) : null;
        $this->tickets->reply($user, $ticket, $values, $request->file('files', []), asTeam: true,
            internal: $request->boolean('internal'), status: $status, revision: isset($values['revision']) ? (int) $values['revision'] : null);

        return (new AdminTicketResource($ticket->refresh()))->response()->setStatusCode(201);
    }

    public function read(Request $request, Ticket $ticket): Response
    {
        $user = $this->team($request);
        $seen = $request->validate(['sequence' => ['sometimes', 'integer', 'min:0']])['sequence'] ?? null;
        $this->tickets->markRead($user, $ticket, true, $seen === null ? null : (int) $seen);

        return response()->noContent();
    }

    public function attachment(Request $request, Ticket $ticket, TicketAttachment $attachment): StreamedResponse
    {
        $this->team($request);
        abort_unless($attachment->ticket_id === $ticket->id, 404);

        return app(TicketAttachments::class)->response($attachment);
    }

    /** Members of the ticket's organization who are not on it yet. */
    public function people(Request $request, Ticket $ticket): JsonResponse
    {
        $this->team($request);

        return response()->json(['data' => TicketController::candidates($ticket, $request)]);
    }

    public function addParticipant(Request $request, Ticket $ticket, User $user): AdminTicketResource
    {
        return new AdminTicketResource($this->tickets->addParticipant($this->team($request), $ticket, $user));
    }

    public function removeParticipant(Request $request, Ticket $ticket, User $user): AdminTicketResource
    {
        return new AdminTicketResource($this->tickets->removeParticipant($this->team($request), $ticket, $user));
    }

    /**
     * Super administrators, who can be assigned tickets.
     */
    public function assignees(Request $request): JsonResponse
    {
        $this->team($request);
        $team = User::query()->where('is_super_admin', true)->orderBy('name')->get(['id', 'name', 'email'])
            ->map(static fn (User $user): array => ['id' => (int) $user->id, 'name' => (string) $user->name, 'email' => (string) $user->email])
            ->all();

        return response()->json(['data' => $team]);
    }

    /** Permanently delete a ticket, for spam or a ticket filed by mistake. */
    public function destroy(Request $request, Ticket $ticket): Response
    {
        $this->tickets->delete($this->team($request), $ticket);

        return response()->noContent();
    }

    private function team(Request $request): User
    {
        $user = $request->user();
        abort_unless($this->access->isTeam($user), 403, 'Only super administrators can work on tickets.');

        return $user;
    }

    private function awaiting(): int
    {
        return Ticket::query()->where('awaiting_team', true)->whereIn('status', TicketStatus::openValues())->count();
    }
}
