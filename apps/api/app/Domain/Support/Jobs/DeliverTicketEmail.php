<?php

declare(strict_types=1);

namespace App\Domain\Support\Jobs;

use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Mail\TicketActivityMail;
use App\Domain\Support\Models\Ticket;
use App\Domain\Support\Models\TicketEvent;
use App\Domain\Support\Models\TicketMessage;
use App\Domain\Support\Services\TicketAccess;
use App\Domain\Support\Services\TicketNotifier;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * Sends one ticket email (spec 015 US5). Access, verification and the person's
 * preferences are checked again here, so losing access or switching ticket emails off
 * before the worker runs cancels the email.
 */
final class DeliverTicketEmail implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 30;

    public function __construct(public readonly int $deliveryId) {}

    public function backoff(): array
    {
        return [30, 120, 600];
    }

    public function handle(TicketAccess $access): void
    {
        DB::transaction(function () use ($access): void {
            $delivery = DB::table('support_ticket_email_deliveries')->where('id', $this->deliveryId)->lockForUpdate()->first();
            if (! $delivery || $delivery->status !== 'pending') {
                return;
            }
            $ticket = Ticket::with('organization')->find($delivery->ticket_id);
            $user = User::find($delivery->user_id);
            $message = $delivery->message_id ? TicketMessage::with('author:id,name')->find($delivery->message_id) : null;
            $event = $delivery->event_id ? TicketEvent::with('actor:id,name')->find($delivery->event_id) : null;
            $team = $delivery->audience === TicketNotifier::TEAM;
            $allowed = $ticket && $user && $user->email_verified_at
                && Preferences::ticketEmail($user)
                && ($team ? $access->isTeam($user) : $access->canSeeAsPerson($user, $ticket))
                && ($message === null || $team || ! $message->internal)
                && ($delivery->message_id === null || $message !== null)
                && ($delivery->event_id === null || $event !== null);
            if (! $allowed) {
                DB::table('support_ticket_email_deliveries')->where('id', $delivery->id)->update(['status' => 'cancelled', 'updated_at' => now()]);

                return;
            }
            Mail::to($user->email)->send(new TicketActivityMail($ticket, $delivery->kind, $team, $message, $event, deliveryId: (int) $delivery->id));
            DB::table('support_ticket_email_deliveries')->where('id', $delivery->id)->update(['status' => 'sent', 'sent_at' => now(), 'updated_at' => now()]);
        });
    }

    public function failed(?\Throwable $exception): void
    {
        DB::table('support_ticket_email_deliveries')->where('id', $this->deliveryId)->where('status', 'pending')->update(['status' => 'failed', 'updated_at' => now()]);
    }
}
