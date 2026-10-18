<?php

declare(strict_types=1);

namespace App\Domain\Support\Http\Controllers;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Enums\TicketStatus;
use App\Domain\Support\Enums\TicketType;
use App\Domain\Support\Http\Resources\TicketResource;
use App\Domain\Support\Http\Resources\TicketSummaryResource;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketAttachment;
use App\Domain\Support\Services\TicketAccess;
use App\Domain\Support\Services\TicketAttachments;
use App\Domain\Support\Services\Tickets;
use App\Domain\Support\Services\TicketView;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Support tickets for the people on them (spec 015): the reporter and the members they
 * tagged. Tickets another member cannot see answer 404, never 403.
 */
final class TicketController
{
    public const PER_PAGE = 25;

    public function __construct(
        private readonly TicketAccess $access,
        private readonly Tickets $tickets,
        private readonly TicketView $view,
    ) {}

    /** The tickets you filed or were tagged on in this organization, open first. */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $input = $request->validate([
            'status' => ['sometimes', Rule::in(['open', 'closed', 'all'])],
            'type' => ['sometimes', Rule::enum(TicketType::class)],
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $user = $request->user();
        $open = TicketStatus::openValues();
        $query = $this->view->withUnread($this->access->visibleIn($user, $organization), $user, false)->with('reporter:id,name');
        match ($input['status'] ?? 'all') {
            'open' => $query->whereIn('support_tickets.status', $open),
            'closed' => $query->whereNotIn('support_tickets.status', $open),
            default => null,
        };
        if (isset($input['type'])) {
            $query->where('support_tickets.type', $input['type']);
        }
        self::search($query, $input['search'] ?? null);
        $page = $query
            ->orderByRaw('CASE WHEN support_tickets.status IN ('.implode(',', array_fill(0, count($open), '?')).') THEN 0 ELSE 1 END', $open)
            ->orderByDesc('support_tickets.last_public_activity_at')->orderByDesc('support_tickets.id')
            ->paginate(self::PER_PAGE);

        return TicketSummaryResource::collection($page);
    }

    /** File a bug report, feature request or improvement. */
    public function store(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless($this->access->isMember($user, $organization->id), 403, 'Only members of this organization can file tickets here.');
        $values = $request->validate([
            'client_id' => ['required', 'uuid'],
            'type' => ['required', Rule::enum(TicketType::class)],
            'title' => ['required', 'string', 'min:3', 'max:150'],
            'body' => ['nullable', 'string', 'max:10000'],
            'context' => ['sometimes', 'array:path,user_agent,screen,time_zone'],
            'context.path' => ['nullable', 'string', 'max:500', 'starts_with:/'],
            'context.user_agent' => ['nullable', 'string', 'max:500'],
            'context.screen' => ['nullable', 'string', 'max:20'],
            'context.time_zone' => ['nullable', 'string', 'max:64'],
            ...TicketAttachments::rules(),
        ]);
        $values['title'] = self::title($values['title']);
        $ticket = $this->tickets->file($user, $organization, $values, $request->file('files', []));

        return (new TicketResource($ticket))->response()->setStatusCode(201);
    }

    /** How many of your tickets in this organization have news for you. */
    public function summary(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $unread = $this->view->whereUnreadForPerson($this->access->visibleIn($user, $organization), $user)->count();

        return response()->json(['data' => ['unread' => $unread]]);
    }

    public function show(Request $request, Organization $organization, Ticket $ticket): TicketResource
    {
        $this->authorizeTicket($request->user(), $organization, $ticket);

        return new TicketResource($ticket);
    }

    /** The reporter renames their ticket or closes it as resolved. */
    public function update(Request $request, Organization $organization, Ticket $ticket): TicketResource
    {
        $user = $request->user();
        $this->authorizeTicket($user, $organization, $ticket);
        abort_unless($ticket->reporter_id === $user->id, 403, 'Only the reporter can change this ticket.');
        $values = $request->validate([
            'title' => ['sometimes', 'string', 'min:3', 'max:150'],
            'status' => ['sometimes', Rule::in([TicketStatus::RESOLVED->value])],
        ]);
        if (isset($values['status']) && ! $ticket->status->isOpen()) {
            throw ValidationException::withMessages(['status' => 'This ticket is already closed.']);
        }
        if (isset($values['title'])) {
            $values['title'] = self::title($values['title']);
        }

        return new TicketResource($this->tickets->update($user, $ticket, $values, false));
    }

    /** Mark the ticket read, up to the `sequence` the page showed when given. */
    public function read(Request $request, Organization $organization, Ticket $ticket): Response
    {
        $this->authorizeTicket($request->user(), $organization, $ticket);
        $seen = $request->validate(['sequence' => ['sometimes', 'integer', 'min:0']])['sequence'] ?? null;
        $this->tickets->markRead($request->user(), $ticket, false, $seen === null ? null : (int) $seen);

        return response()->noContent();
    }

    public function attachment(Request $request, Organization $organization, Ticket $ticket, TicketAttachment $attachment): StreamedResponse
    {
        $this->authorizeTicket($request->user(), $organization, $ticket);
        abort_unless($attachment->ticket_id === $ticket->id, 404);
        abort_if($attachment->message()->value('internal'), 404);

        return app(TicketAttachments::class)->response($attachment);
    }

    /** Members of the ticket's organization the reporter can tag. */
    public function people(Request $request, Organization $organization, Ticket $ticket): JsonResponse
    {
        $user = $request->user();
        $this->authorizeTicket($user, $organization, $ticket);
        abort_unless($ticket->reporter_id === $user->id, 403, 'Only the reporter can tag people.');

        return response()->json(['data' => self::candidates($ticket, $request)]);
    }

    /**
     * Members of the ticket's organization who are not on it yet, 20 at most.
     *
     * @return list<array{id: int, name: string, email: string}>
     */
    public static function candidates(Ticket $ticket, Request $request): array
    {
        $search = trim((string) ($request->validate(['search' => ['sometimes', 'nullable', 'string', 'max:120']])['search'] ?? ''));
        if ($ticket->organization_id === null) {
            return [];
        }
        $like = '%'.mb_strtolower($search).'%';

        return User::query()
            ->join('organization_user', 'organization_user.user_id', '=', 'users.id')
            ->where('organization_user.organization_id', $ticket->organization_id)
            ->where('users.id', '!=', $ticket->reporter_id)
            ->whereNotIn('users.id', fn ($query) => $query->select('user_id')->from('support_ticket_participants')->where('ticket_id', $ticket->id))
            ->when($search !== '', fn (Builder $query) => $query->where(fn (Builder $query) => $query
                ->whereRaw('LOWER(users.name) LIKE ?', [$like])->orWhereRaw('LOWER(users.email) LIKE ?', [$like])))
            ->orderBy('users.name')->limit(20)
            ->get(['users.id', 'users.name', 'users.email'])
            ->map(static fn (User $user): array => ['id' => (int) $user->id, 'name' => (string) $user->name, 'email' => (string) $user->email])
            ->all();
    }

    /**
     * Title search, or a ticket number with or without "#".
     *
     * @param  Builder<Ticket>  $query
     */
    public static function search(Builder $query, ?string $search): void
    {
        $search = trim((string) $search);
        if ($search === '') {
            return;
        }
        $number = ltrim($search, '#');
        $query->where(fn (Builder $query) => $query
            ->whereRaw('LOWER(support_tickets.title) LIKE ?', ['%'.mb_strtolower($search).'%'])
            ->when(ctype_digit($number) && strlen($number) <= 18, fn (Builder $query) => $query->orWhere('support_tickets.id', (int) $number)));
    }

    public static function title(string $title): string
    {
        $title = trim(preg_replace('/\s+/u', ' ', $title) ?? $title);
        if (mb_strlen($title) < 3) {
            throw ValidationException::withMessages(['title' => 'Give the ticket a title of at least 3 characters.']);
        }

        return $title;
    }

    private function authorizeTicket(User $user, Organization $organization, Ticket $ticket): void
    {
        abort_unless($ticket->organization_id === $organization->id && $this->access->canSeeAsPerson($user, $ticket), 404, 'Ticket not found.');
    }
}
