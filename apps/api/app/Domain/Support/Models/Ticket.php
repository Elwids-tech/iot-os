<?php

declare(strict_types=1);

namespace App\Domain\Support\Models;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Support\Enums\TicketPriority;
use App\Domain\Support\Enums\TicketStatus;
use App\Domain\Support\Enums\TicketType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * A bug report, feature request or improvement (spec 015). The id is the ticket number.
 *
 * @property TicketStatus $status
 * @property TicketType $type
 * @property TicketPriority $priority
 */
final class Ticket extends Model
{
    protected $table = 'support_tickets';

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $ticket): void {
            $ticket->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'type' => TicketType::class,
            'status' => TicketStatus::class,
            'priority' => TicketPriority::class,
            'context' => 'array',
            'revision' => 'integer',
            'sequence' => 'integer',
            'public_sequence' => 'integer',
            'awaiting_team' => 'boolean',
            'last_activity_at' => 'datetime',
            'last_public_activity_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function participants(): HasMany
    {
        return $this->hasMany(TicketParticipant::class, 'ticket_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(TicketMessage::class, 'ticket_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(TicketEvent::class, 'ticket_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(TicketAttachment::class, 'ticket_id');
    }
}
