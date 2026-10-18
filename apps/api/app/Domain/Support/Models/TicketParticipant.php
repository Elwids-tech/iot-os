<?php

declare(strict_types=1);

namespace App\Domain\Support\Models;

use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A member tagged on a ticket: they can read it, reply and receive its emails. */
final class TicketParticipant extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'support_ticket_participants';

    protected $guarded = [];

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(Ticket::class, 'ticket_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
