<?php

declare(strict_types=1);

namespace App\Domain\Support\Mail;

use App\Domain\Support\Enums\TicketEventKind;
use App\Domain\Support\Enums\TicketStatus;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketEvent;
use App\Domain\Support\Models\TicketMessage;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Support\Str;

/**
 * A plain-text email about one ticket action. It quotes at most 500 characters of a
 * reply and never carries internal notes, attachments or priority (spec 015 US5).
 */
final class TicketActivityMail extends Mailable
{
    public const EXCERPT = 500;

    public function __construct(
        public Ticket $ticket,
        public string $kind,
        public bool $team,
        public ?TicketMessage $message,
        public ?TicketEvent $event,
        public int $deliveryId,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: sprintf('[#%d] %s', $this->ticket->id, $this->ticket->title));
    }

    public function content(): Content
    {
        $body = $this->message?->body ?? '';
        $attachments = $this->message?->attachments()->count() ?? 0;

        return new Content(text: 'support.ticket-email', with: [
            'lead' => $this->lead(),
            'excerpt' => Str::limit(trim($body), self::EXCERPT),
            'attachments' => $attachments,
            'status' => $this->kind !== 'status' && $this->event?->kind === TicketEventKind::STATUS ? $this->statusLine() : null,
            'link' => $this->link(),
            'footer' => $this->team
                ? 'You receive this because you are a super administrator. Switch ticket emails off in Settings → Email.'
                : 'You receive this because you are on this ticket. Switch ticket emails off in Settings → Email.',
        ]);
    }

    public function headers(): Headers
    {
        $thread = 'ticket-'.$this->ticket->uuid.'@support.iot-os.local';

        return new Headers(messageId: 'ticket-delivery-'.$this->deliveryId.'@support.iot-os.local', references: [$thread], text: ['In-Reply-To' => '<'.$thread.'>']);
    }

    private function lead(): string
    {
        $author = $this->message?->author?->name ?? 'Someone';
        $actor = $this->event?->actor?->name ?? 'Someone';

        return match ($this->kind) {
            'filed' => sprintf('%s filed a new %s in %s:', $author, Str::lower($this->ticket->type->label()), $this->ticket->organization?->name ?? 'a deleted organization'),
            'reply' => sprintf('%s replied:', $author),
            'status' => sprintf('%s %s.', $actor, Str::lcfirst($this->statusLine())),
            'participant_added' => sprintf('%s added you to this ticket. You can now read it and reply.', $actor),
            default => 'There is new activity on this ticket.',
        };
    }

    private function statusLine(): string
    {
        $from = TicketStatus::tryFrom((string) $this->event?->from)?->label() ?? 'unknown';
        $to = TicketStatus::tryFrom((string) $this->event?->to)?->label() ?? 'unknown';

        return sprintf('Changed the status from %s to %s', $from, $to);
    }

    private function link(): string
    {
        if ($this->team) {
            return rtrim((string) config('app.admin_url'), '/').'/tickets/'.$this->ticket->uuid;
        }

        return rtrim((string) config('app.frontend_url'), '/').'/organizations/'.$this->ticket->organization?->uuid.'/support/'.$this->ticket->uuid;
    }
}
