<?php

declare(strict_types=1);

namespace App\Domain\Support\Models;

use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/** A reply everyone on the ticket sees, or an internal note for the team. Never edited. */
final class TicketMessage extends Model
{
    public const UPDATED_AT = null;

    protected $table = 'support_ticket_messages';

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $message): void {
            $message->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return ['internal' => 'boolean', 'from_team' => 'boolean', 'created_at' => 'datetime'];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(Ticket::class, 'ticket_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(TicketAttachment::class, 'message_id');
    }
}
