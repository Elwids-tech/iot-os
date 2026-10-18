<?php

declare(strict_types=1);

namespace App\Domain\Support\Models;

use App\Domain\Shared\Models\User;
use App\Domain\Support\Enums\TicketEventKind;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One change on the ticket's timeline: who changed what, from what, to what. */
final class TicketEvent extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'support_ticket_events';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['kind' => TicketEventKind::class, 'from' => 'json', 'to' => 'json', 'internal' => 'boolean', 'created_at' => 'datetime'];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
